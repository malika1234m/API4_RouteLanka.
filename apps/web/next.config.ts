import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the dev-mode badge so it doesn't cover UI in demos and screenshots.
  devIndicators: false,
  // Screen images for the team's Figma plugin, which fetches them cross-origin.
  async headers() {
    return [{ source: "/figma/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
};

export default nextConfig;
