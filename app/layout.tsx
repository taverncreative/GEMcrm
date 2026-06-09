import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BUSINESS } from "@/lib/constants/branding";
import { ServiceWorkerRegister } from "@/components/sync/service-worker-register";

export const viewport: Viewport = {
  // Fit the layout to the device width so phones don't render at a default
  // 980px desktop width and scale down (which both shrinks text and creates
  // phantom horizontal scroll on small viewports).
  width: "device-width",
  initialScale: 1,
  // Allow the user to pinch-zoom for accessibility — we just don't want
  // iOS to AUTO-zoom on input focus. That's solved separately by ensuring
  // input font-size is ≥16px on mobile (see globals.css).
  maximumScale: 5,
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Per-route titles use `${title} — ${BUSINESS.name} CRM` via the template.
  title: {
    default: `${BUSINESS.name} CRM`,
    template: `%s — ${BUSINESS.name} CRM`,
  },
  description: "Pest control CRM",
  // Tells Next.js to use the GEM logo for favicons + apple touch icons.
  // The actual asset is /app/icon.png (Next conventional location).
  icons: { icon: "/icon.png", apple: "/icon.png" },
  // iOS add-to-homescreen: run standalone (no Safari chrome) when launched
  // from the home screen. Android/Chrome use the web app manifest instead.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "GEM CRM" },
  // Internal CRM — robots.txt also disallows; metadata is belt-and-braces.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Pull the Supabase host so we can preconnect — the browser kicks off
  // TCP + TLS in parallel with HTML parsing, so the first data fetch on
  // every page lands quicker (saves ~100-200ms on cold sessions).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseHost = supabaseUrl
    ? new URL(supabaseUrl).origin
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <head>
        {supabaseHost && (
          <>
            <link rel="preconnect" href={supabaseHost} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={supabaseHost} />
          </>
        )}
      </head>
      <body className="h-full bg-gray-50 text-gray-900 antialiased">
        {/* Prod-only: registers public/sw.js for offline navigation. */}
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
