"use server";

import { revalidatePath } from "next/cache";
import { AgreementSchema } from "@/lib/validation/agreement";
import { createAgreement } from "@/lib/data/agreements";
import { getSiteById } from "@/lib/data/sites";
import { generateAgreementJobs } from "@/lib/services/agreement-events";
import { generateAgreementPdf } from "@/lib/pdf/generate-agreement-pdf";
import { uploadPdf } from "@/lib/storage/upload";
import { getCustomerById } from "@/lib/data/customers";
import { createClient } from "@/lib/supabase/server";
import { sendAgreement } from "@/lib/services/email";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

export async function createAgreementAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const siteId = formData.get("site_id") as string;

  if (!siteId) {
    return { success: false, errors: {}, message: "Missing site ID" };
  }

  const site = await getSiteById(siteId);
  if (!site) {
    return { success: false, errors: {}, message: "Site not found" };
  }

  let pestSpecies: string[] = [];
  const pestSpeciesRaw = formData.get("pest_species") as string;
  if (pestSpeciesRaw) {
    try {
      const parsed: unknown = JSON.parse(pestSpeciesRaw);
      if (Array.isArray(parsed)) {
        pestSpecies = parsed.filter(
          (item): item is string => typeof item === "string" && item.length > 0
        );
      }
    } catch {
      pestSpecies = [];
    }
  }

  // Defensive: formData.get() returns null for missing keys (a field
  // not rendered, omitted by a conditional, etc). Zod's optional
  // string fields accept undefined but REJECT null — silent action
  // failure. Coerce null → "" before Zod. Same pattern as
  // createCustomerAction + completeServiceSheetAction + createSite +
  // createBookingAction.
  const str = (key: string): string =>
    (formData.get(key) as string | null) ?? "";

  const raw = {
    customer_id: site.customer_id,
    site_id: siteId,
    reference_number: str("reference_number"),
    start_date: str("start_date"),
    visit_frequency: str("visit_frequency"),
    pest_species: pestSpecies,
    callout_terms: str("callout_terms"),
    contract_value: str("contract_value"),
    contact_name: str("contact_name"),
    contact_phone: str("contact_phone"),
    mobile: str("mobile"),
    contact_email: str("contact_email"),
    invoice_address: str("invoice_address"),
    terms_text: str("terms_text"),
    client_signature: str("client_signature"),
    gem_signature: str("gem_signature"),
    client_signatory_name: str("client_signatory_name"),
    signed_date: str("signed_date"),
  };

  const result = AgreementSchema.safeParse(raw);

  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        errors[key] = issue.message;
      }
    }
    return { success: false, errors, message: null };
  }

  try {
    const agreement = await createAgreement(result.data);
    await generateAgreementJobs(agreement);

    // Generate the contract PDF (name-only — always proceeds). A render
    // failure is non-fatal: the agreement is still created and the PDF is
    // backfillable, so it stays fenced.
    try {
      const customer = await getCustomerById(site.customer_id);
      if (customer) {
        const pdfBuffer = await generateAgreementPdf({
          agreement,
          customer,
          site,
        });
        const pdfUrl = await uploadPdf(
          pdfBuffer,
          `agreements/${agreement.id}/contract.pdf`
        );
        // Save PDF URL to agreement
        const supabase = await createClient();
        await supabase
          .from("agreements")
          .update({ contract_pdf_url: pdfUrl })
          .eq("id", agreement.id);

        // Send only when there's an email. No email → generated, NOT sent —
        // an explicit skip, not a swallowed sendAgreement({success:false}).
        // The client gate offers to add an email before submitting, so a
        // willing operator reaches here with one on file.
        if (customer.email) {
          await sendAgreement(customer, pdfUrl);
        }
      }
    } catch (pdfErr) {
      console.error(
        "[createAgreementAction] PDF generate/send failed:",
        pdfErr
      );
    }
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create agreement",
    };
  }

  revalidatePath(ROUTES.siteDetail(siteId));
  revalidatePath(ROUTES.customerDetail(site.customer_id));
  return { success: true, errors: {}, message: "Agreement created" };
}
