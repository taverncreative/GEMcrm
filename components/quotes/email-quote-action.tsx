"use client";

import { useRouter } from "next/navigation";
import { EmailDocumentButton } from "@/components/documents/email-document-button";

/**
 * "Email" on the quote detail page.
 *
 * A thin client wrapper over the shared document email button: the send path,
 * composer and confirmation are identical to the Documents list, and the send
 * itself marks the quote sent server-side. This only adds the refresh, so the
 * Draft badge on the page becomes Sent the moment the email goes out instead
 * of waiting for a manual reload.
 */
export function EmailQuoteAction({
  quoteId,
  title,
  prefillEmail,
  customerId,
}: {
  quoteId: string;
  title: string;
  prefillEmail: string | null;
  customerId: string | null;
}) {
  const router = useRouter();
  return (
    <EmailDocumentButton
      kind="quote"
      docId={quoteId}
      title={title}
      prefillEmail={prefillEmail}
      customerId={customerId}
      variant="primary"
      onSent={() => router.refresh()}
    />
  );
}
