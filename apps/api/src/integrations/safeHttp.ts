import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/**
 * SSRF-safe outbound HTTP for user-supplied URLs (outbound webhooks, Slack, workflow webhooks).
 * URLs must be https, resolve only to public addresses, and the connection is pinned to the
 * validated address so a second DNS answer cannot redirect it (DNS rebinding).
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class OutboundHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundHttpError";
  }
}

// ---- Address classification -------------------------------------------------------------------

const V4_BLOCKED_CIDRS: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT (also Alibaba metadata 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
}

const V4_RANGES = V4_BLOCKED_CIDRS.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (v4ToInt(base) & mask) >>> 0, mask };
});

function isBlockedV4Int(n: number): boolean {
  return V4_RANGES.some((r) => ((n & r.mask) >>> 0) === r.network);
}

/** Eight 16-bit groups, or null when the text is not an IPv6 address. Accepts a dotted IPv4 tail and a %zone. */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!net.isIPv4(tail)) return null;
    const n = v4ToInt(tail);
    s = `${s.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isBlockedV6(g: number[]): boolean {
  const embeddedV4 = ((g[6] << 16) | g[7]) >>> 0;
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  // ::ffff:a.b.c.d (IPv4-mapped), ::a.b.c.d (IPv4-compatible, incl. :: and ::1), 64:ff9b::a.b.c.d (NAT64)
  if (zeros(0, 5) && g[5] === 0xffff) return isBlockedV4Int(embeddedV4);
  if (zeros(0, 6)) return true;
  if (g[0] === 0x64 && g[1] === 0xff9b) return zeros(2, 6) ? isBlockedV4Int(embeddedV4) : true;
  // 6to4 embeds the IPv4 address in groups 1-2.
  if (g[0] === 0x2002) return isBlockedV4Int(((g[1] << 16) | g[2]) >>> 0);

  // Only global unicast (2000::/3) is reachable; this excludes ULA fc00::/7 (incl. AWS fd00:ec2::254),
  // link-local fe80::/10, site-local fec0::/10, multicast ff00::/8 and discard 100::/64.
  if ((g[0] & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] < 0x0200) return true; // Teredo, benchmarking, ORCHID and other IETF special-purpose
  return false;
}

/** True for any address an outbound request must not reach (private, loopback, link-local, CGNAT, multicast, metadata, ...). */
export function isBlockedIp(ip: string): boolean {
  const value = ip.trim().replace(/^\[|\]$/g, "");
  if (net.isIPv4(value)) return isBlockedV4Int(v4ToInt(value));
  if (net.isIPv6(value) || value.includes(":")) {
    const groups = expandIPv6(value);
    return groups ? isBlockedV6(groups) : true;
  }
  return true;
}

// ---- URL validation ---------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface UrlPolicy {
  /** Exact hostnames the URL (and any redirect) must use, e.g. ["hooks.slack.com"]. */
  allowedHosts?: string[];
  /** Default true. Only tests turn this off. */
  requireHttps?: boolean;
  /** Default isBlockedIp. */
  isBlockedAddress?: (ip: string) => boolean;
  /** Default dns.lookup(all). */
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
}

export interface SafeTarget {
  url: URL;
  host: string;
  address: string;
  family: number;
}

const INTERNAL_HOSTNAME = /(^|\.)(localhost|localdomain|local|internal|intranet|lan|home\.arpa)$/i;

async function defaultResolve(host: string): Promise<ResolvedAddress[]> {
  return dns.promises.lookup(host, { all: true, verbatim: true });
}

/** Throws UnsafeUrlError unless the URL is https and every address it resolves to is public. */
export async function assertSafeUrl(raw: string, policy: UrlPolicy = {}): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    throw new UnsafeUrlError("The URL is not valid.");
  }
  const requireHttps = policy.requireHttps !== false;
  if (url.protocol !== "https:" && (requireHttps || url.protocol !== "http:")) {
    throw new UnsafeUrlError("The URL must start with https://.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("The URL must not contain a username or password.");

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new UnsafeUrlError("The URL has no host.");
  if (policy.allowedHosts && !policy.allowedHosts.includes(host)) {
    throw new UnsafeUrlError(`The URL host must be ${policy.allowedHosts.join(" or ")}.`);
  }

  const blocked = policy.isBlockedAddress ?? isBlockedIp;
  let addresses: ResolvedAddress[];
  const literal = net.isIP(host);
  if (literal) {
    addresses = [{ address: host, family: literal }];
  } else {
    if (INTERNAL_HOSTNAME.test(host) || !host.includes(".")) {
      throw new UnsafeUrlError("The URL must point to a public internet host.");
    }
    try {
      addresses = await (policy.resolve ?? defaultResolve)(host);
    } catch {
      throw new UnsafeUrlError(`The host ${host} could not be resolved.`);
    }
  }
  if (addresses.length === 0) throw new UnsafeUrlError(`The host ${host} could not be resolved.`);
  if (addresses.some((a) => blocked(a.address))) {
    throw new UnsafeUrlError("The URL points to a private, loopback, link-local or other internal address, which is not allowed.");
  }
  return { url, host, address: addresses[0].address, family: addresses[0].family || net.isIP(addresses[0].address) };
}

// ---- Requests ---------------------------------------------------------------------------------

export interface SafeRequestOptions extends UrlPolicy {
  headers?: Record<string, string>;
  /** Total time budget across redirects. Default 10s. */
  timeoutMs?: number;
  /** Response bytes kept; the rest is discarded and the connection closed. Default 64 KB. */
  maxResponseBytes?: number;
  /** Method-preserving redirects (307/308) followed, each re-validated. Default 3. */
  maxRedirects?: number;
}

export interface SafeResponse {
  status: number;
  body: string;
  /** True when the body was cut at maxResponseBytes. */
  truncated: boolean;
  url: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

interface RawResponse {
  status: number;
  body: string;
  truncated: boolean;
  location?: string;
}

function sendOnce(target: SafeTarget, body: string, options: SafeRequestOptions, deadline: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new OutboundHttpError("The request timed out."));
    const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    // Pin the connection to the address that was validated.
    const lookup = (_host: string, opts: any, cb: (...args: any[]) => void) => {
      const callback = typeof opts === "function" ? opts : cb;
      if (opts && typeof opts === "object" && opts.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const transport = target.url.protocol === "https:" ? https : http;
    const req = transport.request(
      target.url,
      {
        method: "POST",
        headers: { ...options.headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: lookup as any,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const done = () =>
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
              location: typeof res.headers.location === "string" ? res.headers.location : undefined,
            })
          );
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = maxBytes - size;
          if (chunk.length > room) {
            if (room > 0) chunks.push(chunk.subarray(0, room));
            size = maxBytes;
            truncated = true;
            done();
            res.destroy();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        res.on("end", done);
        res.on("error", (err) => finish(() => reject(new OutboundHttpError(`Network error: ${err.message}`))));
      }
    );
    const timer = setTimeout(() => {
      finish(() => reject(new OutboundHttpError("The request timed out.")));
      req.destroy();
    }, remaining);
    req.on("error", (err: NodeJS.ErrnoException) =>
      finish(() => reject(new OutboundHttpError(err.code === "ECONNREFUSED" ? "The endpoint refused the connection." : `Network error: ${err.message}`)))
    );
    req.end(body);
  });
}

/**
 * POSTs `body` to a user-supplied URL with SSRF protection, a total timeout and a response size cap.
 * Only 307/308 redirects are followed (re-validated each hop); other redirects are errors.
 */
export async function safePost(rawUrl: string, body: string, options: SafeRequestOptions = {}): Promise<SafeResponse> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRedirects = options.maxRedirects ?? 3;
  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    const target = await assertSafeUrl(current, options);
    const res = await sendOnce(target, body, options, deadline);
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (res.status !== 307 && res.status !== 308) {
        throw new OutboundHttpError(`The endpoint redirected (HTTP ${res.status}); only 307/308 redirects are followed.`);
      }
      if (hop >= maxRedirects) throw new OutboundHttpError("The endpoint redirected too many times.");
      current = new URL(res.location, target.url).toString();
      continue;
    }
    return { status: res.status, body: res.body, truncated: res.truncated, url: target.url.toString() };
  }
}
