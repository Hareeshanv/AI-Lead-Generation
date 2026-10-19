import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const originOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

// Must match the fallback in src/services/api/http.ts.
const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api");
const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseRealtime = supabaseOrigin?.replace(/^http/, "ws");

const connectSrc = ["'self'", apiOrigin, supabaseOrigin, supabaseRealtime, ...(isDev ? ["ws:"] : [])].filter(Boolean);

// Next.js and the theme bootstrap script in app/layout.tsx are inline, so scripts need 'unsafe-inline'
// (a nonce would force every page to render dynamically). React dev tooling also needs 'unsafe-eval'.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets a production preview build run alongside `next dev`, which owns `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Opt-in (the Dockerfile sets it): standalone tracing creates symlinks, which fail on Windows without admin rights.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Lint runs once for the whole repo (`pnpm lint`, CI), not again inside every build.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ["recharts", "lucide-react"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
