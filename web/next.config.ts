import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The page's copy of the server's checker model, so saved double-check verdicts are restored only under the same
  // model (lib/checkPolicy.ts). A model name, not a secret.
  env: { NEXT_PUBLIC_ATLAS_CHECKER_MODEL: process.env.ATLAS_CHECKER_MODEL || "" },
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
