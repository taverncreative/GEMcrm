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

  const raw = {
    customer_id: site.customer_id,
    site_id: siteId,
    reference_number: formData.get("reference_number") as string,
    start_date: formData.get("start_date") as string,
    visit_frequency: formData.get("visit_frequency") as string,
    pest_species: pestSpecies,
    callout_terms: formData.get("callout_terms") as string,
    contract_value: formData.get("contract_value") as string,
    contact_name: formData.get("contact_name") as string,
    contact_phone: formData.get("contact_phone") as string,
    mobile: formData.get("mobile") as string,
    contact_email: formData.get("contact_email") as string,
    invoice_address: formData.get("invoice_address") as string,
    terms_text: formData.get("terms_text") as string,
    client_signature: formData.get("client_signature") as string,
    gem_signature: formData.get("gem_signature") as string,
    client_signatory_name: formData.get("client_signatory_name") as string,
    signed_date: formData.get("signed_date") as string,
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

    // Generate contract PDF
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

        // Send agreement email to customer
        await sendAgreement(customer, pdfUrl);
      }
    } catch (pdfErr) {
      console.error("[createAgreementAction] PDF generation failed:", pdfErr);
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
