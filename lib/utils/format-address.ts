import type { Site } from "@/types/database";

export function formatAddress(site: Site): string {
  return [site.address_line_1, site.town, site.postcode]
    .filter(Boolean)
    .join(", ");
}
