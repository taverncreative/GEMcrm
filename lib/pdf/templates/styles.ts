import { MONTSERRAT_FACE_CSS } from "@/lib/pdf/assets";

export const PDF_STYLES = `
  ${MONTSERRAT_FACE_CSS}

  :root {
    --brand: #4EA25A;       /* section heading text */
    --brand-rule: #72BA42;  /* header rule + tags / badges */
    --brand-dark: #3E7D2C;  /* footer strip + badge text */
    --brand-pale: #EDF4E1;  /* pale tints (badges, tags) */
  }

  @page {
    /* Page margins (top 20mm, L/R 22mm, bottom = footer-band height) are set
       by Puppeteer's page.pdf so it can also reserve the bottom margin for the
       running footer band. Leaving @page margin unset here is deliberate — a
       CSS @page margin OVERRIDES the page.pdf margin, which would break both
       the footer reservation and the content insets. */
    size: A4;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1f2937;
    font-size: 11px;
    line-height: 1.55;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    max-width: 794px;
    margin: 0 auto;
    padding: 0;
  }

  /* The old "G"-square .header lockup and its .title/.subtitle typography were
     removed once the invoice and agreement moved onto renderDocHeader (the
     shared .doc-header lockup). All three documents now share one branded
     header. */

  /* ─── Section ─── */
  .section {
    margin-bottom: 28px;
  }
  .section-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--brand);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 14px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
  }
  .section-card {
    background: #f9fafb;
    border: 1px solid #f3f4f6;
    border-radius: 10px;
    padding: 20px;
  }

  /* ─── Grid ─── */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
  }

  /* ─── Field ─── */
  .field {
    margin-bottom: 12px;
  }
  .field:last-child {
    margin-bottom: 0;
  }
  .field-label {
    font-size: 10px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 3px;
  }
  .field-value {
    font-size: 11px;
    color: #1f2937;
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .field-value-large {
    font-size: 13px;
    font-weight: 600;
    color: #111827;
    line-height: 1.3;
  }

  /* ─── Badge ─── */
  .badge {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 14px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.4;
  }
  .badge-green { background: var(--brand-pale); color: var(--brand-dark); }
  .badge-amber { background: #fef3c7; color: #92400e; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-blue { background: #dbeafe; color: #1e40af; }
  .badge-grey { background: #f3f4f6; color: #374151; }

  /* ─── Tags ─── */
  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 600;
    background: var(--brand-pale);
    color: var(--brand-dark);
  }

  /* ─── Terms ─── */
  .terms {
    font-size: 9.5px;
    color: #4b5563;
    line-height: 1.7;
  }
  .terms p {
    margin-bottom: 6px;
  }
  .terms strong {
    color: #1f2937;
    font-size: 10px;
  }
  .terms-card {
    background: #f9fafb;
    border: 1px solid #f3f4f6;
    border-radius: 10px;
    padding: 20px;
  }

  /* ─── Signatures ─── */
  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .sig-box {
    border: 1.5px solid #e5e7eb;
    border-radius: 10px;
    padding: 16px;
    background: #fafafa;
    min-height: 110px;
  }
  .sig-label {
    font-size: 10px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 10px;
  }
  .sig-img {
    display: block;
    max-width: 200px;
    height: 65px;
    object-fit: contain;
  }
  .sig-empty {
    height: 65px;
    border: 1.5px dashed #d1d5db;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #9ca3af;
  }
  .sig-date {
    margin-top: 12px;
    font-size: 10px;
    color: #6b7280;
  }

  /* ─── Warning ─── */
  .warning-box {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #fef3c7;
    border: 1px solid #fbbf24;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 10px;
    color: #92400e;
    font-weight: 600;
    margin-top: 8px;
  }

  /* ─── Table ─── */
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  .data-table th {
    text-align: left;
    font-size: 9px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 8px 10px;
    border-bottom: 1.5px solid #e5e7eb;
  }
  .data-table td {
    padding: 8px 10px;
    border-bottom: 1px solid #f3f4f6;
    color: #374151;
  }

  /* ─── Print safety ─── */
  .page-break-before {
    page-break-before: always;
  }
  .avoid-break {
    page-break-inside: avoid;
  }

  /* ─── Branded doc header (shared partial) ─── */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 18px;
    margin-bottom: 26px;
    border-bottom: 3px solid var(--brand-rule);
  }
  .doc-brand { display: flex; flex-direction: column; gap: 10px; }
  .doc-lockup { display: flex; align-items: center; gap: 12px; }
  .doc-logo { height: 54px; width: auto; }
  .doc-wordmark {
    font-size: 21px;
    font-weight: 800;
    letter-spacing: 3px;
    color: #111827;
    line-height: 1;
  }
  .doc-tagline {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #6b7280;
    margin-top: 4px;
  }
  .doc-doctype {
    font-size: 12px;
    font-weight: 600;
    color: var(--brand-dark);
    letter-spacing: 0.3px;
  }
  .doc-meta {
    text-align: right;
    font-size: 10px;
    color: #6b7280;
    line-height: 1.85;
  }
  .doc-meta strong {
    display: block;
    color: #374151;
    font-weight: 700;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .doc-meta-row { margin-bottom: 8px; }
  .doc-meta-row:last-child { margin-bottom: 0; }

  /* The branded green contact band is NOT in this document's flow — it's a
     per-page running footer drawn by Puppeteer's footerTemplate as a baked
     image (htmlToPdf), so it pins to the bottom of every page including a
     partial last page. Its height is reserved as the bottom page margin, so
     flowing content never overlaps it. */

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 0; max-width: none; }
  }
`;
