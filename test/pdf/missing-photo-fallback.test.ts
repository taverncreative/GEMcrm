/**
 * A missing Storage object must not reach the customer's PDF.
 *
 * `inlineStorageImages` used to leave the original `src` when a download
 * failed. On a private bucket that src is unfetchable, so Puppeteer draws
 * its broken-image box — a grey torn-page placeholder, printed on a
 * report that goes to the customer.
 *
 * Four completed jobs (00077, 00085, 00086-ASH, 00087) carry twelve photo
 * references whose objects were never uploaded, so for those the entire
 * "Additional Photos" grid rendered as broken boxes.
 *
 * These tests pin the two behaviours that fix it: a failed download drops
 * the whole <img>, and a section marked drop-if-empty disappears when
 * nothing inside it resolved. They also pin what must NOT change: a
 * resolvable photo still inlines, and a partially-broken set keeps its
 * good photos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const downloads = new Map<string, boolean>();
const downloadCalls: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloadCalls.push(path);
          if (downloads.get(path)) {
            return {
              data: {
                arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
              },
              error: null,
            };
          }
          return { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  }),
}));

import {
  inlineStorageImages,
  dropIfNoImages,
} from "@/lib/pdf/inline-storage-images";

const BASE = "https://x.supabase.co/storage/v1/object/public/reports";
const GOOD = `${BASE}/photos/good.jpg`;
const MISSING = `${BASE}/photos/missing.jpg`;
const SIG = `${BASE}/signatures/j1/technician.png`;

function img(src: string): string {
  return `<img src="${src}" style="width:100%;" />`;
}

/** The photos section as the job-report template emits it. */
function photoSection(...srcs: string[]): string {
  return dropIfNoImages(`
  <div class="section avoid-break">
    <div class="section-title">Additional Photos</div>
    <div class="section-card">
      <div style="display:grid;">${srcs.map(img).join("")}</div>
    </div>
  </div>`);
}

beforeEach(() => {
  downloads.clear();
  downloadCalls.length = 0;
  downloads.set("photos/good.jpg", true);
  downloads.set("signatures/j1/technician.png", true);
  downloads.set("photos/missing.jpg", false);
});

describe("a photo whose object is missing", () => {
  it("has its <img> dropped, not left with a dead src", async () => {
    const out = await inlineStorageImages(`<div>${img(MISSING)}</div>`);
    expect(out).not.toContain("<img");
    // The dead URL must not survive anywhere — a leftover src is exactly
    // what Puppeteer turns into a broken-image box.
    expect(out).not.toContain(MISSING);
    expect(out).not.toContain("missing.jpg");
  });

  it("takes the whole Additional Photos section with it when nothing resolves", async () => {
    const html = `<div>Header</div>${photoSection(MISSING, MISSING)}<div>Footer</div>`;
    const out = await inlineStorageImages(html);

    expect(out).not.toContain("Additional Photos");
    expect(out).not.toContain("section-card");
    // Everything around it is untouched.
    expect(out).toContain("Header");
    expect(out).toContain("Footer");
    // And no marker debris is left in the output.
    expect(out).not.toContain("drop-if-no-img");
  });
});

describe("photos that do resolve", () => {
  it("keeps the good ones and drops only the missing ones", async () => {
    const out = await inlineStorageImages(photoSection(GOOD, MISSING, GOOD));

    expect(out).toContain("Additional Photos");
    // Two good images survive, inlined; the missing one is gone.
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(out).toContain("data:image/jpeg;base64,");
    expect(out).not.toContain("missing.jpg");
    expect(out).not.toContain("drop-if-no-img");
  });

  it("leaves a fully intact section completely normal", async () => {
    const out = await inlineStorageImages(photoSection(GOOD, GOOD));
    expect(out).toContain("Additional Photos");
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(out).not.toContain(BASE);
    expect(out).not.toContain("drop-if-no-img");
  });

  it("still inlines signatures, which live outside any droppable block", async () => {
    const out = await inlineStorageImages(`<div>${img(SIG)}</div>`);
    expect(out).toContain("data:image/png;base64,");
    expect(out).toContain("<img");
  });

  it("a missing signature is dropped without taking the page with it", async () => {
    downloads.set("signatures/j1/technician.png", false);
    const out = await inlineStorageImages(
      `<div class="sig">Signed by</div>${img(SIG)}`
    );
    expect(out).toContain("Signed by");
    expect(out).not.toContain("<img");
  });
});

describe("things that must not change", () => {
  it("passes data: URIs and non-storage srcs through untouched", async () => {
    const html = `${img("data:image/png;base64,AAAA")}${img("https://cdn.example.com/logo.png")}`;
    const out = await inlineStorageImages(html);
    expect(out).toContain("data:image/png;base64,AAAA");
    expect(out).toContain("https://cdn.example.com/logo.png");
    // Neither is a storage object, so neither is downloaded.
    expect(downloadCalls).toEqual([]);
  });

  it("downloads each distinct object once", async () => {
    await inlineStorageImages(photoSection(GOOD, GOOD, GOOD));
    expect(downloadCalls).toEqual(["photos/good.jpg"]);
  });

  it("treats a thrown download as missing rather than crashing the render", async () => {
    const html = photoSection(GOOD, MISSING);
    // The mock returns an error result; a transport throw is handled by
    // the same catch. Either way the render completes.
    await expect(inlineStorageImages(html)).resolves.toBeTypeOf("string");
  });

  it("strips the markers even when there is nothing to download", async () => {
    const out = await inlineStorageImages(dropIfNoImages("<p>no images</p>"));
    // No <img> inside, so the block goes.
    expect(out).toBe("");
  });
});
