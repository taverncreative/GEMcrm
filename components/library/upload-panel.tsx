"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  isAllowedUpload,
} from "@/lib/library/file-types";

/**
 * Add-document panel at the top of the library page (collapsible). Posts a
 * multipart body to /api/library/upload — a real File can't cross a server
 * action's serialisation, so this is a plain fetch. On success it refreshes
 * the server-rendered list. Online-only (the whole feature is).
 */

const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

export function UploadPanel() {
  const router = useRouter();
  const online = useIsOnline();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current || busy) return;
    setError(null);

    const fd = new FormData(formRef.current);
    const label = ((fd.get("label") as string) ?? "").trim();
    const file = fd.get("file");
    if (!label) {
      setError("Give the document a label.");
      return;
    }
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (!isAllowedUpload(file.name)) {
      setError("Unsupported file type. Allowed: PDF, Word, Excel, images.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File is too large (max ${MAX_MB} MB).`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/library/upload", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Upload failed. Try again.");
        setBusy(false);
        return;
      }
      formRef.current.reset();
      setFileName(null);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add document
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Add a document</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div>
        <label htmlFor="lib-label" className="mb-1 block text-xs font-medium text-gray-600">
          Label
        </label>
        <input
          id="lib-label"
          name="label"
          type="text"
          required
          maxLength={200}
          placeholder="e.g. Pest control service record"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div>
        <label htmlFor="lib-category" className="mb-1 block text-xs font-medium text-gray-600">
          Category <span className="text-gray-400">(optional)</span>
        </label>
        <input
          id="lib-category"
          name="category"
          type="text"
          maxLength={100}
          placeholder="e.g. Health &amp; Safety"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div>
        <label htmlFor="lib-file" className="mb-1 block text-xs font-medium text-gray-600">
          File
        </label>
        <input
          id="lib-file"
          name="file"
          type="file"
          accept={ACCEPT}
          required
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-darker hover:file:bg-brand-soft/80"
        />
        <p className="mt-1 text-xs text-gray-400">
          PDF, Word, Excel, or images. Up to {MAX_MB} MB.
          {fileName ? ` Selected: ${fileName}` : ""}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      {!online && (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You&rsquo;re offline — uploading needs a connection.
        </p>
      )}

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !online}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}
