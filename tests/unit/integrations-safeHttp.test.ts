import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OutboundHttpError,
  UnsafeUrlError,
  assertSafeUrl,
  expandIPv6,
  isBlockedIp,
  safePost,
  type ResolvedAddress,
} from "../../apps/api/src/integrations/safeHttp";

const resolveTo = (...addresses: string[]) => async (): Promise<ResolvedAddress[]> =>
  addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.0.1",
    "100.64.0.1",
    "100.100.100.200",
    "0.0.0.0",
    "224.0.0.1",
    "239.255.255.250",
    "255.255.255.255",
    "198.18.0.1",
    "192.0.2.10",
  ])("blocks IPv4 %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34", "169.255.0.1"])("allows public IPv4 %s", (ip) =>
    expect(isBlockedIp(ip)).toBe(false)
  );

  it.each([
    "::1",
    "::",
    "fe80::1",
    "fe80::1%eth0",
    "fc00::1",
    "fd00:ec2::254",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:0001::1",
    "2001:db8::1",
    "2001::1",
    "[::1]",
  ])("blocks IPv6 %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"])("allows public IPv6 %s", (ip) =>
    expect(isBlockedIp(ip)).toBe(false)
  );

  it("blocks anything that is not an IP", () => {
    expect(isBlockedIp("example.com")).toBe(true);
    expect(isBlockedIp("1:2:3")).toBe(true);
  });

  it("expands IPv6 with embedded IPv4", () => {
    expect(expandIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(expandIPv6("1::")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(expandIPv6("1::2::3")).toBeNull();
  });
});

describe("assertSafeUrl", () => {
  const reject = (url: string, policy = {}) => expect(assertSafeUrl(url, { resolve: resolveTo("93.184.216.34"), ...policy })).rejects.toBeInstanceOf(UnsafeUrlError);

  it("accepts https URLs that resolve to public addresses and returns the pinned address", async () => {
    const target = await assertSafeUrl("https://hooks.example.com/path?q=1", { resolve: resolveTo("93.184.216.34") });
    expect(target).toMatchObject({ host: "hooks.example.com", address: "93.184.216.34", family: 4 });
  });

  it("requires https and rejects credentials and junk", async () => {
    await reject("http://hooks.example.com/");
    await reject("ftp://hooks.example.com/");
    await reject("https://user:pass@hooks.example.com/");
    await reject("not a url");
    await reject("");
  });

  it("rejects private, loopback, metadata and mapped literals, including numeric IPv4 forms", async () => {
    for (const url of [
      "https://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[fd00:ec2::254]/",
      "https://0x7f.0.0.1/",
      "https://2130706433/",
      "https://10.0.0.1:8443/",
    ]) {
      await reject(url);
    }
  });

  it("rejects internal host names before resolving", async () => {
    let resolved = false;
    const resolve = async () => {
      resolved = true;
      return [{ address: "93.184.216.34", family: 4 }];
    };
    for (const url of ["https://localhost/", "https://api.localhost/", "https://metadata.google.internal/", "https://printer.local/", "https://intranet/"]) {
      await expect(assertSafeUrl(url, { resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    expect(resolved).toBe(false);
  });

  it("rejects hosts where any resolved address is internal (DNS rebinding / split answers)", async () => {
    await reject("https://evil.example.com/", { resolve: resolveTo("93.184.216.34", "10.0.0.5") });
    await reject("https://evil.example.com/", { resolve: resolveTo("::ffff:169.254.169.254") });
    await reject("https://evil.example.com/", { resolve: async () => [] });
    await reject("https://evil.example.com/", {
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
  });

  it("enforces an allowed host list (Slack)", async () => {
    const policy = { allowedHosts: ["hooks.slack.com"], resolve: resolveTo("93.184.216.34") };
    await expect(assertSafeUrl("https://hooks.slack.com/services/T/B/x", policy)).resolves.toMatchObject({ host: "hooks.slack.com" });
    await expect(assertSafeUrl("https://hooks.slack.com.evil.com/services/x", policy)).rejects.toThrow(/hooks\.slack\.com/);
    await expect(assertSafeUrl("https://evil.com/hooks.slack.com/", policy)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("safePost", () => {
  // A local http server stands in for the internet: the test policy allows plain http and 127.0.0.1 only.
  let server: http.Server;
  let base = "";
  const hits: string[] = [];
  const testPolicy = {
    requireHttps: false,
    isBlockedAddress: (ip: string) => ip !== "127.0.0.1" && isBlockedIp(ip),
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url || "");
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const port = (server.address() as AddressInfo).port;
        switch (req.url) {
          case "/ok":
            res.writeHead(200, { "Content-Type": "text/plain" }).end(`echo:${body}`);
            break;
          case "/to-metadata":
            res.writeHead(307, { Location: "http://169.254.169.254/latest/meta-data" }).end();
            break;
          case "/to-mapped":
            res.writeHead(308, { Location: "http://[::ffff:10.0.0.1]/" }).end();
            break;
          case "/to-ok":
            res.writeHead(307, { Location: `http://127.0.0.1:${port}/ok` }).end();
            break;
          case "/found":
            res.writeHead(302, { Location: `http://127.0.0.1:${port}/ok` }).end();
            break;
          case "/loop":
            res.writeHead(307, { Location: "/loop" }).end();
            break;
          case "/big":
            res.writeHead(200);
            res.end("x".repeat(200_000));
            break;
          case "/slow":
            setTimeout(() => res.writeHead(200).end("late"), 2_000);
            break;
          default:
            res.writeHead(404).end("missing");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("refuses plain http and internal targets with the default policy (no request is made)", async () => {
    const before = hits.length;
    await expect(safePost(`${base}/ok`, "{}")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safePost("https://127.0.0.1/ok", "{}")).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(hits.length).toBe(before);
  });

  it("posts the body and returns status and response text", async () => {
    const res = await safePost(`${base}/ok`, '{"a":1}', { ...testPolicy, headers: { "Content-Type": "application/json" } });
    expect(res).toMatchObject({ status: 200, body: 'echo:{"a":1}', truncated: false });
  });

  it("re-validates redirect targets and refuses internal ones", async () => {
    await expect(safePost(`${base}/to-metadata`, "{}", testPolicy)).rejects.toThrow(/private, loopback, link-local/);
    await expect(safePost(`${base}/to-mapped`, "{}", testPolicy)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("follows safe 307/308 redirects but not 302, and caps redirect chains", async () => {
    await expect(safePost(`${base}/to-ok`, "hi", testPolicy)).resolves.toMatchObject({ status: 200, body: "echo:hi" });
    await expect(safePost(`${base}/found`, "hi", testPolicy)).rejects.toThrow(/HTTP 302/);
    await expect(safePost(`${base}/loop`, "hi", { ...testPolicy, maxRedirects: 2 })).rejects.toThrow(/too many/);
  });

  it("caps the response size", async () => {
    const res = await safePost(`${base}/big`, "{}", { ...testPolicy, maxResponseBytes: 1024 });
    expect(res.status).toBe(200);
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1024);
  });

  it("times out slow endpoints", async () => {
    const started = Date.now();
    await expect(safePost(`${base}/slow`, "{}", { ...testPolicy, timeoutMs: 300 })).rejects.toBeInstanceOf(OutboundHttpError);
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
