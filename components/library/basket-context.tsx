"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { clampQuantity } from "@/lib/validation/print-order";

/**
 * Print-basket state for the site-folder library.
 *
 * Backed by localStorage so it SURVIVES NAVIGATION and reloads — the
 * provider is mounted once in the app shell (above the router outlet), so
 * adding documents on the library page, navigating away, and coming back
 * keeps the basket intact. Single device, ephemeral until confirmed, so
 * localStorage (not Dexie/sync) is the right home.
 *
 * Quantities only — there is no pricing anywhere in this feature.
 */

export interface BasketItem {
  documentId: string;
  label: string;
  quantity: number;
}

interface BasketContextValue {
  items: BasketItem[];
  /** True once localStorage has been read — guards SSR/first-paint mismatch. */
  hydrated: boolean;
  totalItems: number;
  totalQuantity: number;
  quantityOf: (documentId: string) => number;
  has: (documentId: string) => boolean;
  add: (documentId: string, label: string, quantity?: number) => void;
  setQuantity: (documentId: string, quantity: number) => void;
  remove: (documentId: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "gemcrm-print-basket";

const BasketContext = createContext<BasketContextValue | null>(null);

function loadInitial(): BasketItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive parse — drop anything that isn't a well-formed line.
    return parsed
      .filter(
        (i): i is BasketItem =>
          i &&
          typeof i.documentId === "string" &&
          typeof i.label === "string" &&
          typeof i.quantity === "number"
      )
      .map((i) => ({ ...i, quantity: clampQuantity(i.quantity) }));
  } catch {
    return [];
  }
}

export function BasketProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<BasketItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR/client mismatch).
  useEffect(() => {
    setItems(loadInitial());
    setHydrated(true);
  }, []);

  // Persist on change — only after hydration, so the initial empty state
  // never clobbers a stored basket before it's read.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full / unavailable — the in-memory basket still works.
    }
  }, [items, hydrated]);

  const add = useCallback(
    (documentId: string, label: string, quantity = 1) => {
      setItems((prev) => {
        const existing = prev.find((i) => i.documentId === documentId);
        if (existing) {
          return prev.map((i) =>
            i.documentId === documentId
              ? { ...i, quantity: clampQuantity(i.quantity + quantity) }
              : i
          );
        }
        return [...prev, { documentId, label, quantity: clampQuantity(quantity) }];
      });
    },
    []
  );

  const setQuantity = useCallback((documentId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.documentId === documentId
          ? { ...i, quantity: clampQuantity(quantity) }
          : i
      )
    );
  }, []);

  const remove = useCallback((documentId: string) => {
    setItems((prev) => prev.filter((i) => i.documentId !== documentId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<BasketContextValue>(() => {
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
    return {
      items,
      hydrated,
      totalItems: items.length,
      totalQuantity,
      quantityOf: (id) => items.find((i) => i.documentId === id)?.quantity ?? 0,
      has: (id) => items.some((i) => i.documentId === id),
      add,
      setQuantity,
      remove,
      clear,
    };
  }, [items, hydrated, add, setQuantity, remove, clear]);

  return (
    <BasketContext.Provider value={value}>{children}</BasketContext.Provider>
  );
}

export function useBasket(): BasketContextValue {
  const ctx = useContext(BasketContext);
  if (!ctx) {
    throw new Error("useBasket must be used within a BasketProvider");
  }
  return ctx;
}
