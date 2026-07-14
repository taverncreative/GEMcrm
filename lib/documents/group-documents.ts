import type { DocumentItem } from "@/lib/data/documents";
import { customerDisplayName } from "@/lib/utils/customer-display-name";

/**
 * Client-side grouping + customer search for the Documents list (Phase 2).
 * Pure transforms over the already-loaded items — no storage change, no
 * server round-trip. Grouping is by customer; documents with no customer on
 * file fall into a single trailing "No customer" group.
 */

export const NO_CUSTOMER_KEY = "__no_customer__";

export interface DocumentGroup {
  /** customer.id, or NO_CUSTOMER_KEY for documents with no customer. */
  key: string;
  /** Header label: the customer's display name (company first), or a
   *  neutral placeholder for the no-customer group. */
  label: string;
  count: number;
  /** The group's documents, in the order they arrived (newest-first, since
   *  getAllDocuments already sorts globally newest-first). */
  items: DocumentItem[];
  /** The most recent document date in the group — drives group ordering. */
  latestDate: string;
}

/** The text a customer search matches against: name + company, lower-cased. */
export function customerSearchText(
  customer: DocumentItem["customer"]
): string {
  if (!customer) return "";
  return [customer.name, customer.company_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Filter documents to those whose customer name/company matches the query.
 *  An empty/whitespace query returns the list unchanged. Documents with no
 *  customer never match a non-empty query. */
export function filterDocumentsByCustomer(
  items: DocumentItem[],
  query: string
): DocumentItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => customerSearchText(i.customer).includes(q));
}

/**
 * Group documents by customer, preserving each group's incoming (newest-first)
 * order. Groups are ordered by most-recent activity (the group's newest
 * document) so the customer you last worked with floats to the top; the
 * "No customer" group always sorts last.
 */
export function groupDocumentsByCustomer(
  items: DocumentItem[]
): DocumentGroup[] {
  const map = new Map<string, DocumentGroup>();
  for (const item of items) {
    const key = item.customer?.id ?? NO_CUSTOMER_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: item.customer
          ? customerDisplayName(item.customer)
          : "No customer on file",
        count: 0,
        items: [],
        latestDate: item.date,
      };
      map.set(key, group);
    }
    group.items.push(item);
    group.count += 1;
    if (new Date(item.date).getTime() > new Date(group.latestDate).getTime()) {
      group.latestDate = item.date;
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.key === NO_CUSTOMER_KEY) return 1;
    if (b.key === NO_CUSTOMER_KEY) return -1;
    return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
  });
}
