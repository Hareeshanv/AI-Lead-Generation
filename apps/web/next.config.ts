import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a production preview build run alongside `next dev`, which owns `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@ai-lead-gen/ui", "@ai-lead-gen/types"],
  experimental: {
    optimizePackageImports: ["recharts", "lucide-react", "date-fns"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
