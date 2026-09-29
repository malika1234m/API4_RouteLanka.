import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RouteLanka",
    short_name: "RouteLanka",
    description: "Delivery planning for Waypoint Group: ordering, planning, loading, delivery and receipt in one relay.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1e31",
    theme_color: "#16233a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
