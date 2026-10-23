import type { NextConfig } from "next";

// Cache Components stays off: every screen reads live Snowflake state per request, and route
// handlers use the classic `dynamic` / `runtime` segment configs.
const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;
