/**
 * Vitest global setup.
 *
 *  - Pulls in fake-indexeddb so Dexie works inside jsdom.
 *  - Loads jest-dom matchers (`toBeInTheDocument`, etc).
 *  - Provides env vars the form / wrapper code reads at runtime.
 *  - Mocks next/navigation globally so components that call useRouter /
 *    useParams don't crash. Per-test overrides go in the test file.
 */
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// photoPublicUrl reads this at runtime.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

// next/navigation isn't available outside Next's bundler. Stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({ id: "test-job-id" }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
