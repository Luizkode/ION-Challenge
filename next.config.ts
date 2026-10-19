import type { NextConfig } from "next";
import { verifySupabaseConfiguration } from "./lib/supabase-config";
verifySupabaseConfiguration(process.env);
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/analytics/reports/*/pdf": ["./assets/fonts/*.ttf"],
  },
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
