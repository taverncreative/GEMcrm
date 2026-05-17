export const PDF_STYLES = `
  @page {
    size: A4;
    margin: 20mm 22mm 24mm 22mm;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
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

  /* ─── Typography ─── */
  .title {
    font-size: 26px;
    font-weight: 700;
    color: #111827;
    letter-spacing: -0.3px;
    line-height: 1.15;
  }
  .subtitle {
    font-size: 13px;
    font-weight: 400;
    color: #6b7280;
    margin-top: 2px;
  }

  /* ─── Header ─── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 20px;
    margin-bottom: 28px;
    border-bottom: 2.5px solid #059669;
  }
  .header-brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .header-icon {
    width: 44px;
    height: 44px;
    background: #059669;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 22px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .header-text .company {
    font-size: 22px;
    font-weight: 700;
    color: #111827;
    line-height: 1.2;
  }
  .header-text .doc-type {
    font-size: 12px;
    color: #6b7280;
    font-weight: 400;
    margin-top: 1px;
  }
  .header-meta {
    text-align: right;
    font-size: 10px;
    color: #6b7280;
    line-height: 1.7;
  }
  .header-meta strong {
    color: #374151;
    font-weight: 600;
  }

  /* ─── Section ─── */
  .section {
    margin-bottom: 28px;
  }
  .section-title {
    font-size: 13px;
    font-weight: 700;
    color: #059669;
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
  .badge-green { background: #d1fae5; color: #065f46; }
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
    font-weight: 500;
    background: #e5e7eb;
    color: #374151;
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

  /* ─── Footer ─── */
  .footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1.5px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    font-size: 8.5px;
    color: #9ca3af;
    line-height: 1.7;
  }
  .footer-left {
    max-width: 60%;
  }
  .footer-right {
    text-align: right;
  }
  .footer-company {
    font-weight: 600;
    color: #6b7280;
    font-size: 9px;
  }

  /* ─── Print safety ─── */
  .page-break-before {
    page-break-before: always;
  }
  .avoid-break {
    page-break-inside: avoid;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 0; max-width: none; }
  }
`;
