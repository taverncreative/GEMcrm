"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GemCRM:App] Error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          There was a problem loading this page.
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
