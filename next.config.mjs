/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Bundle the golden-demo cache into the /api/sift serverless function.
    // src/lib/cache.ts reads this file at runtime via process.cwd(); Vercel's
    // file tracer won't include it automatically (it's read with fs, not
    // imported), so we declare it here. Without this, the cache read would miss
    // in production and the golden demo would fall through to a live query.
    outputFileTracingIncludes: {
      "/api/sift": ["./src/data/cache.json"],
    },
  },
};

export default nextConfig;
