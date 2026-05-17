import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React 19 ships a stricter `set-state-in-effect` rule that fires
      // on patterns we use intentionally:
      //   - the SSR-hydration `mounted` pattern (WidgetFrame, app-shell)
      //   - modal open/reset effects that wipe form state when a modal
      //     toggles open (booking + invoice modals)
      //   - error-tracker effects that sync server-action errors into
      //     scroll-into-view focus state (add-agreement-form, service-sheet-form)
      //   - side-panel data-load effects that flip a loading flag and
      //     fetch when a new customer id is selected (customer-side-panel)
      //
      // All of these are documented patterns where the cascading re-render
      // is exactly what we want. Downgraded to "warn" so they're visible
      // in lint output but don't fail CI. Real new violations (e.g. an
      // accidental write where an event handler would do) should still
      // be caught by code review.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
