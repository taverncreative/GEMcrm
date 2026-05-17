"use client";

/**
 * Top-of-tree error boundary. Catches errors thrown in the root layout
 * itself (e.g. font loading, html shell) which the regular `app/error.tsx`
 * boundary can't reach — by the time it'd render, the layout has already
 * crashed.
 *
 * Renders a full HTML document because there's no parent shell to inherit.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in server logs / browser console. When Sentry / Logflare is
    // wired up, hook the captureException call here.
    console.error("[GemCRM] Top-level error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f5f7",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 480, padding: 32, textAlign: "center" }}>
          <p
            style={{
              fontSize: 12,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "#9ca3af",
              margin: 0,
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ marginTop: 8, fontSize: 22, color: "#111827" }}>
            We hit an unexpected error
          </h1>
          <p
            style={{
              marginTop: 8,
              fontSize: 14,
              color: "#4b5563",
              lineHeight: 1.5,
            }}
          >
            The team has been notified. You can try again, or head back to the
            dashboard.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: 12,
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                color: "#9ca3af",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <div style={{ marginTop: 24 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                display: "inline-block",
                background: "#75B845",
                color: "#fff",
                border: 0,
                padding: "10px 20px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
