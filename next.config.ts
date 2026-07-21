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
  // serverExternalPackages keeps sparticuz OUT of the bundle, but the
  // function then needs its Brotli blobs (bin/chromium.br, fonts,
  // swiftshader, AL2023 libs) traced into the deployment — they're read
  // at runtime via computed fs paths, which output tracing can't see.
  // Without this, chromium.executablePath() throws on Vercel and every
  // PDF fails ("PDF gen failed" — production launch finding). Keyed on
  // ALL routes ('/*') deliberately: invoice/sheet PDF server actions
  // POST to whichever page hosts the form, and the offline outbox
  // replay can run completeServiceSheetAction from ANY route the app
  // is on when sync drains — per-route tracing would leave holes
  // exactly where replays land.
  outputFileTracingIncludes: {
    // Chromium blobs (above) PLUS the PDF brand assets: the Montserrat
    // woff2 + gem-mark logo are read at runtime via fs in lib/pdf/assets.ts
    // and base64-inlined into every PDF's HTML. Computed fs reads are
    // invisible to output tracing, so they're force-included here — without
    // it the read throws on Vercel and every PDF fails. Keyed '/*' for the
    // same reason as chromium: PDF generation runs from many routes/replays.
    "/*": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./lib/pdf/fonts/**/*",
      "./public/logo/gem-services-logo.png",
      // Montserrat static TTFs (Regular + Bold), traced to /var/task/fonts so
      // @sparticuz/chromium's fontconfig registers "Montserrat" as a SYSTEM font
      // — the ONLY way the footerTemplate context can use it (it ignores
      // @font-face). fontconfig scans /var/task/fonts by default (per the
      // package README). Referenced by family name in renderDocumentFooter.
      "./fonts/**/*",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  // Service worker headers. `no-cache` (must-revalidate) on /sw.js so the
  // browser always revalidates the SW script itself — a new deploy's SW is
  // picked up promptly instead of being served stale (the classic PWA
  // stale-SW footgun). `Service-Worker-Allowed: /` lets it claim root scope.
  // Header rules are served by the Next runtime, independent of the bundler,
  // so this works under Turbopack.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
