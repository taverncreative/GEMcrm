/**
 * The headline name for a customer: the company when one is set, otherwise
 * the contact's name. Commercial customers show as their company (e.g.
 * "Green Farm Spa"); domestic customers — and any commercial record with no
 * company_name yet — fall back to the contact's name.
 *
 * Display-only. The contact name (`c.name`) stays available separately so
 * callers can render it as a secondary line beneath the headline. Do NOT
 * use this where the contact PERSON is meant (email greetings, the
 * job-reference code, labelled "Company"/contact field rows).
 *
 * Accepts any customer-shaped object (Customer, CustomerDetail, list items,
 * job.site.customer, PDF customer), so it only needs the two fields.
 */
export function customerDisplayName(c: {
  company_name?: string | null;
  name: string;
}): string {
  return c.company_name?.trim() || c.name;
}
