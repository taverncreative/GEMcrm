import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BUSINESS } from "@/lib/constants/branding";

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
  // Internal CRM — robots.txt also disallows; metadata is belt-and-braces.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="h-full bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
