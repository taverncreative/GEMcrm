"use client";

import { useRef, useState, useCallback } from "react";
import Image from "next/image";

interface PhotoUploadProps {
  /** Called whenever the list changes. Values are data-URLs (base64). */
  onChange: (photos: string[]) => void;
}

const MAX_FILES = 10;
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB per file
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

interface QueuedPhoto {
  id: string;
  dataUrl: string;
  name: string;
  size: number;
}

/**
 * Drag-and-drop photo picker.
 *
 * Reads each file as a base64 data-URL and hands the full list to the parent
 * via `onChange`. Base64 matches the existing pattern (signatures) — the server
 * action decodes and uploads to Supabase Storage.
 *
 * Why read everything as data-URL client-side rather than POSTing files directly:
 *   - Consistency with the rest of the app's upload pipeline (signatures).
 *   - Works with the existing action-state form flow (plain FormData strings).
 *   - No multipart or presigned-URL infra required.
 *   - Trade-off: large files bloat the request. Hard-capped at MAX_FILE_SIZE.
 */
export function PhotoUpload({ onChange }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(
    (list: QueuedPhoto[]) => {
      setPhotos(list);
      onChange(list.map((p) => p.dataUrl));
    },
    [onChange]
  );

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const input = Array.from(files);
    const room = MAX_FILES - photos.length;
    if (room <= 0) {
      setError(`Maximum ${MAX_FILES} photos per job.`);
      return;
    }

    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of input.slice(0, room)) {
      if (!ACCEPTED.includes(f.type) && !f.type.startsWith("image/")) {
        rejected.push(`${f.name}: unsupported type`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        rejected.push(`${f.name}: over 8 MB`);
        continue;
      }
      accepted.push(f);
    }

    try {
      const loaded = await Promise.all(
        accepted.map(async (f) => ({
          id: `${f.name}-${f.size}-${f.lastModified}-${crypto.randomUUID()}`,
          dataUrl: await fileToDataUrl(f),
          name: f.name,
          size: f.size,
        }))
      );
      publish([...photos, ...loaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read files");
    }

    if (rejected.length > 0) {
      setError(rejected.join(" · "));
    }
  }

  function removeAt(id: string) {
    publish(photos.filter((p) => p.id !== id));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      void addFiles(e.dataTransfer.files);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      void addFiles(e.target.files);
    }
    // reset so selecting the same file twice still triggers onChange
    e.target.value = "";
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`block w-full rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? "border-brand bg-brand-soft"
            : "border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
        }`}
      >
        <svg
          className="mx-auto h-10 w-10 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
          />
        </svg>
        <p className="mt-3 text-sm font-medium text-gray-700">
          {isDragging ? "Drop to add" : "Drag photos here, or click to browse"}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Up to {MAX_FILES} photos · 8 MB each
        </p>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onInputChange}
      />

      {error && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo) => (
            <li
              key={photo.id}
              className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white"
            >
              <div className="relative aspect-square w-full">
                <Image
                  src={photo.dataUrl}
                  alt={photo.name}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <button
                type="button"
                onClick={() => removeAt(photo.id)}
                aria-label={`Remove ${photo.name}`}
                className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
              <p className="truncate px-2 py-1 text-[11px] text-gray-500">
                {photo.name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
