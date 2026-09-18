import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  turbopack: {
    root: process.cwd(),
  },
  // The extension download zips files read at runtime, which the bundler can't see on its own.
  outputFileTracingIncludes: {
    "/api/ext/download": ["./extension/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
