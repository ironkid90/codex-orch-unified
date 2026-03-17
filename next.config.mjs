import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
