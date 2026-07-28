/**
 * Draft / Sent badge for a quote (quotes.status, migration 045).
 *
 * "Sent" is written only when an email has actually gone out, so the badge
 * answers the question the list could not before: which of these has the
 * customer actually seen? Anything other than 'sent' reads as Draft, so a
 * legacy row is never mislabelled as delivered.
 */
export function QuoteStatusBadge({ status }: { status: string | null }) {
  const sent = status === "sent";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
        sent
          ? "bg-brand-soft text-brand-darker"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          sent ? "bg-brand" : "bg-gray-400"
        }`}
      />
      {sent ? "Sent" : "Draft"}
    </span>
  );
}
