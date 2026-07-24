"use client";

import { useEffect, useRef, useState } from "react";
import { searchProductsLocal, findProductByBrandLocal } from "@/lib/db/lookups";
import { saveProductLocalFirst } from "@/lib/products/local-first";
import { newId } from "@/lib/utils/id";
import type { Product, ProductUsed } from "@/types/database";

/**
 * "Products Used" repeatable-rows field (migration 047) — replaces the old
 * free-text "Pesticides Used" textarea on the service sheet.
 *
 * Each row = a product (type-ahead by BRAND name, offline via the Dexie
 * mirror) + a completely free-text quantity (no unit parsing). Mobile-first,
 * big tap targets. ZERO rows is valid (survey visits) — the field never forces
 * a row.
 *
 * Unlisted brand → "Add '<typed>' as a new product" reveals an inline chemical
 * field; saving creates the product offline-first (outbox) so it's in the list
 * next time. If Nate can't supply the chemical, he skips it: the product is
 * saved with a null chemical, the customer PDF shows a neutral fallback (never
 * the brand), and the picker re-prompts to fill it next time (self-heal).
 */

// Shared field styling WITHOUT a width — callers add the width they need
// (the product/chemical inputs go full width, the quantity input is fixed).
const fieldBase =
  "rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const inputClass = `block w-full ${fieldBase}`;

interface ProductsUsedFieldProps {
  products: ProductUsed[];
  onChange: (next: ProductUsed[]) => void;
}

export function ProductsUsedField({ products, onChange }: ProductsUsedFieldProps) {
  function updateRow(index: number, next: ProductUsed) {
    onChange(products.map((p, i) => (i === index ? next : p)));
  }
  function removeRow(index: number) {
    onChange(products.filter((_, i) => i !== index));
  }
  function addRow() {
    onChange([
      ...products,
      { product_id: null, brand_name: "", chemical_name: null, quantity: "" },
    ]);
  }

  return (
    <div className="space-y-2">
      {products.length === 0 && (
        <p className="text-sm text-gray-400">
          No products added. For a survey or inspection with no product applied,
          that&rsquo;s fine — leave it empty.
        </p>
      )}

      {products.map((row, index) => (
        <ProductRow
          key={index}
          row={row}
          onChange={(next) => updateRow(index, next)}
          onRemove={() => removeRow(index)}
        />
      ))}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        Add product
      </button>
    </div>
  );
}

interface ProductRowProps {
  row: ProductUsed;
  onChange: (next: ProductUsed) => void;
  onRemove: () => void;
}

function ProductRow({ row, onChange, onRemove }: ProductRowProps) {
  // The brand field doubles as the type-ahead query. When a product is picked
  // it holds the brand; while typing an unlisted brand it holds free text.
  const [query, setQuery] = useState(row.brand_name);
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  // Inline "add new product" chemical capture (unlisted brand).
  const [addingChemical, setAddingChemical] = useState(false);
  // Inline "fill missing chemical" capture (picked a product with no chemical).
  const [fillingChemical, setFillingChemical] = useState(false);
  const [chemDraft, setChemDraft] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Debounced Dexie search as the operator types the brand.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void searchProductsLocal(query).then((rows) => {
        if (!cancelled) setResults(rows);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  // Close the dropdown on outside click/tap.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const trimmed = query.trim();
  const exactMatch = results.some(
    (p) => p.brand_name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  const showAddOption = trimmed.length > 0 && !exactMatch;

  function pickProduct(p: Product) {
    onChange({
      product_id: p.id,
      brand_name: p.brand_name,
      chemical_name: p.chemical_name,
      quantity: row.quantity,
    });
    setQuery(p.brand_name);
    setOpen(false);
    // Self-heal: a listed product missing its chemical name → prompt to add it.
    if (!p.chemical_name?.trim()) {
      setChemDraft("");
      setFillingChemical(true);
    }
  }

  async function confirmNewProduct() {
    const brand = trimmed;
    if (!brand) return;
    // Guard against a race where the brand was added on another row meanwhile.
    const existing = await findProductByBrandLocal(brand);
    const id = existing?.id ?? newId();
    const chemical = chemDraft.trim() ? chemDraft.trim() : null;
    await saveProductLocalFirst(
      { id, brand_name: brand, chemical_name: chemical },
      existing ? "update" : "create"
    );
    onChange({
      product_id: id,
      brand_name: brand,
      chemical_name: chemical,
      quantity: row.quantity,
    });
    setAddingChemical(false);
    setChemDraft("");
    setOpen(false);
  }

  async function confirmFillChemical() {
    if (!row.product_id) return;
    const chemical = chemDraft.trim() ? chemDraft.trim() : null;
    await saveProductLocalFirst(
      { id: row.product_id, brand_name: row.brand_name, chemical_name: chemical },
      "update"
    );
    onChange({ ...row, chemical_name: chemical });
    setFillingChemical(false);
    setChemDraft("");
  }

  return (
    <div
      ref={rootRef}
      className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5"
    >
      <div className="flex items-start gap-2">
        {/* Product type-ahead (brand) */}
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setAddingChemical(false);
              // Typing a new brand detaches any previously picked product.
              if (row.product_id) {
                onChange({
                  product_id: null,
                  brand_name: e.target.value,
                  chemical_name: null,
                  quantity: row.quantity,
                });
              }
            }}
            onFocus={() => setOpen(true)}
            placeholder="Product (type to search)"
            aria-label="Product"
            className={inputClass}
          />

          {open && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProduct(p)}
                  className="block w-full px-3 py-2.5 text-left text-sm text-gray-900 hover:bg-gray-50"
                >
                  {p.brand_name}
                  {!p.chemical_name?.trim() && (
                    <span className="ml-1 text-xs text-amber-600">
                      (needs chemical)
                    </span>
                  )}
                </button>
              ))}

              {showAddOption && !addingChemical && (
                <button
                  type="button"
                  onClick={() => {
                    setChemDraft("");
                    setAddingChemical(true);
                  }}
                  className="block w-full border-t border-gray-100 px-3 py-2.5 text-left text-sm font-medium text-brand-darker hover:bg-gray-50"
                >
                  + Add &ldquo;{trimmed}&rdquo; as a new product
                </button>
              )}

              {addingChemical && (
                <div className="border-t border-gray-100 p-2.5">
                  <label className="block text-xs font-medium text-gray-600">
                    Chemical name{" "}
                    <span className="text-gray-400">(customer-facing)</span>
                  </label>
                  <input
                    type="text"
                    value={chemDraft}
                    onChange={(e) => setChemDraft(e.target.value)}
                    placeholder="e.g. brodifacoum 0.005% block"
                    className={`mt-1 ${inputClass}`}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    This is what the customer sees. Your brand name is never
                    shown to them.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={confirmNewProduct}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
                    >
                      Save product
                    </button>
                    <button
                      type="button"
                      onClick={confirmNewProduct}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Skip &mdash; add later
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Free-text quantity */}
        <input
          type="text"
          value={row.quantity}
          onChange={(e) => onChange({ ...row, quantity: e.target.value })}
          placeholder="e.g. 20g, 2 sachets, 1 block"
          aria-label="Quantity"
          className={`w-28 shrink-0 sm:w-36 ${fieldBase}`}
        />

        {/* Remove */}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove product"
          className="mt-0.5 shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Self-heal: picked a listed product with no chemical name yet. */}
      {fillingChemical && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <label className="block text-xs font-medium text-amber-800">
            Add the chemical name for{" "}
            <span className="font-semibold">{row.brand_name}</span>{" "}
            <span className="text-amber-600">(customer-facing)</span>
          </label>
          <input
            type="text"
            value={chemDraft}
            onChange={(e) => setChemDraft(e.target.value)}
            placeholder="e.g. brodifacoum 0.005% block"
            className={`mt-1 ${inputClass}`}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirmFillChemical}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setFillingChemical(false)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Later
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
