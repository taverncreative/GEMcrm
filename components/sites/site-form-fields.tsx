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
 * Inputs are CONTROLLED: the owning form holds the five values and passes
 * them back down with an onChange. They were uncontrolled (read via FormData
 * on submit), which was fine for the edit form — it submits via onSubmit, so
 * React never resets it — but wrong for the create form, which is a
 * `<form action={fn}>`: React 19 resets uncontrolled inputs once the action
 * settles, so a server validation bounce wiped the whole address the
 * operator had just typed.
 *
 * The inputs keep their `name` attributes, so both owners' existing
 * FormData-based submit paths are unchanged — controlled inputs serialise
 * into FormData exactly the same way. Only the ownership of the values
 * moved. Sites have no name/label column — `SiteInput`/`SiteSchema` is the
 * five address fields only.
 */
export interface SiteFieldValues {
  address_line_1: string;
  address_line_2: string;
  town: string;
  county: string;
  postcode: string;
}

/** Loose shape of anything that can seed the fields (a `Site` row, or
 *  nothing at all for a fresh create). */
export interface SiteFieldDefaults {
  address_line_1?: string | null;
  address_line_2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
}

/**
 * Seed the five values from an existing row (edit) or from nothing
 * (create). Owners pass this to `useState` so the initial values are read
 * once, on mount.
 */
export function siteFieldValues(defaults?: SiteFieldDefaults): SiteFieldValues {
  const dv = (v: string | null | undefined): string => v ?? "";
  return {
    address_line_1: dv(defaults?.address_line_1),
    address_line_2: dv(defaults?.address_line_2),
    town: dv(defaults?.town),
    county: dv(defaults?.county),
    postcode: dv(defaults?.postcode),
  };
}

interface SiteFormFieldsProps {
  errors: Record<string, string>;
  values: SiteFieldValues;
  onChange: (field: keyof SiteFieldValues, value: string) => void;
}

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500";
const labelClass = "block text-sm font-medium text-gray-700";

export function SiteFormFields({
  errors,
  values,
  onChange,
}: SiteFormFieldsProps) {
  const set =
    (field: keyof SiteFieldValues) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange(field, e.target.value);

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
          value={values.address_line_1}
          onChange={set("address_line_1")}
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
          value={values.address_line_2}
          onChange={set("address_line_2")}
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
            value={values.town}
            onChange={set("town")}
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
            value={values.county}
            onChange={set("county")}
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
          value={values.postcode}
          onChange={set("postcode")}
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
