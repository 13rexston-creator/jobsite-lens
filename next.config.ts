import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Plan page images (rendered client-side, up to ~5 MB per full-resolution
  // JPEG) exceed the framework's 1 MB default body limit.
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
