import type { NextConfig } from "next";

// Static export: the app is fully client-side, so the build produces plain
// HTML/JS in apps/web/out that the API server serves in production. One
// deployable service, same origin, no CORS setup.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
