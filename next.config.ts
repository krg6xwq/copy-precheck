import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The rules and test set are read from content/ at runtime by the server
  // action. Make sure they're included in the deployed server bundle.
  outputFileTracingIncludes: {
    "/*": ["./content/**/*.yaml"],
  },
};

export default nextConfig;
