import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The iPhone app's helper links are Universal Links, verified with this file. It has no extension, so its type
  // can't be inferred from the name; Apple expects it served as JSON.
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
