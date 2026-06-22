"use client";

/**
 * Shared presentational field-set for the site create + edit forms.
 *
 * Renders ONLY the address inputs (with their `name` attributes) and inline
 * validation errors — no `<form>`, no submit, no data layer. Each owning
 * form keeps its own submit path: the create form ({@link AddSiteForm}) stays
 * a `useActionState(createSiteAction)` form; the edit form is a plain
 * online-only action. Sharing only the markup keeps the verified create flow
 * untouched.
 *
 * Inputs are uncontrolled (read via FormData on submit). `defaults` pre-fills
 * them for edit; create omits it, so the inputs render empty exactly as
 * before. Sites have no name/label column — `SiteInput`/`SiteSchema` is the
 * five address fields only.
 */
export interface SiteFieldDefaults {
  address_line_1?: string | null;
  address_line_2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
}

interface SiteFormFieldsProps {
  errors: Record<string, string>;
  defaults?: SiteFieldDefaults;
}

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500";
const labelClass = "block text-sm font-medium text-gray-700";

export function SiteFormFields({ errors, defaults }: SiteFormFieldsProps) {
  const dv = (v: string | null | undefined): string => v ?? "";

  return (
    <>
      <div>
        <label htmlFor="address_line_1" className={labelClass}>
          Address Line 1 <span className="text-red-500">*</span>
        </label>
        <input
          id="address_line_1"
          name="address_line_1"
          type="text"
          required
          autoFocus
          defaultValue={dv(defaults?.address_line_1)}
          className={inputClass}
          placeholder="Street address"
        />
        {errors.address_line_1 && (
          <p className="mt-1 text-sm text-red-500">{errors.address_line_1}</p>
        )}
      </div>

      <div>
        <label htmlFor="address_line_2" className={labelClass}>
          Address Line 2
        </label>
        <input
          id="address_line_2"
          name="address_line_2"
          type="text"
          defaultValue={dv(defaults?.address_line_2)}
          className={inputClass}
          placeholder="Flat, unit, etc."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="town" className={labelClass}>
            Town <span className="text-red-500">*</span>
          </label>
          <input
            id="town"
            name="town"
            type="text"
            required
            defaultValue={dv(defaults?.town)}
            className={inputClass}
            placeholder="Town"
          />
          {errors.town && (
            <p className="mt-1 text-sm text-red-500">{errors.town}</p>
          )}
        </div>

        <div>
          <label htmlFor="county" className={labelClass}>
            County <span className="text-red-500">*</span>
          </label>
          <input
            id="county"
            name="county"
            type="text"
            required
            defaultValue={dv(defaults?.county)}
            className={inputClass}
            placeholder="County"
          />
          {errors.county && (
            <p className="mt-1 text-sm text-red-500">{errors.county}</p>
          )}
        </div>
      </div>

      <div className="max-w-xs">
        <label htmlFor="postcode" className={labelClass}>
          Postcode
        </label>
        <input
          id="postcode"
          name="postcode"
          type="text"
          defaultValue={dv(defaults?.postcode)}
          className={`${inputClass} uppercase`}
          placeholder="Postcode"
        />
        {errors.postcode && (
          <p className="mt-1 text-sm text-red-500">{errors.postcode}</p>
        )}
      </div>
    </>
  );
}
