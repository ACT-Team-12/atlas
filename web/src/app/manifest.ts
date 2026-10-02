import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ATLAS: after-visit plan",
    short_name: "ATLAS",
    description: "Turn your visit paper into steps you can finish. Every step quotes your paper.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf8f3",
    theme_color: "#bfe9dc",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
