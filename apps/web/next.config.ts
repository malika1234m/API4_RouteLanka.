import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Hide the dev-mode badge so it doesn't cover UI in demos and screenshots.
  devIndicators: false,
  // The shared rules and contract are TypeScript source in the monorepo.
  transpilePackages: ["@routelanka/domain"],
  // Standalone output keeps the Docker image small.
  output: "standalone",
  // Browser calls go to /api on the same origin, so session cookies stay first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      // Screen images for the team's Figma plugin, which fetches them cross-origin.
      { source: "/figma/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
      // The service worker must be able to control the whole app.
      { source: "/sw.js", headers: [{ key: "Service-Worker-Allowed", value: "/" }, { key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
