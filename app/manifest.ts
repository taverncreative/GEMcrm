import type { MetadataRoute } from "next";
import { BUSINESS } from "@/lib/constants/branding";

/**
 * Web App Manifest (Next conventional file → served at /manifest.webmanifest).
 * Enables add-to-homescreen so the field tech runs the CRM as a standalone
 * app. Icons are placeholder-quality (generated from the brand logo); polish
 * the maskable safe-zone later.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BUSINESS.name} CRM`,
    short_name: "GEM CRM",
    description: "Pest control CRM",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#3c3c3b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
