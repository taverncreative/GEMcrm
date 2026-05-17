import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Puppeteer (full) + sparticuz chromium are huge native binaries that
  // must not be bundled into serverless function output — they're loaded
  // dynamically from node_modules at runtime by `lib/pdf/html-to-pdf.ts`.
  // Vercel honours this list to keep the function bundle under the 50 MB cap.
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "@sparticuz/chromium",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
