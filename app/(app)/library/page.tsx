import { getLibraryDocuments } from "@/lib/data/library-documents";
import { UploadPanel } from "@/components/library/upload-panel";
import { LibraryDocumentRow } from "@/components/library/library-document-row";
import { BasketBar } from "@/components/library/basket-bar";
import type { LibraryDocument } from "@/types/database";

export const metadata = { title: "Site folders" };

// Online-only, server-rendered (no Dexie mirror) — the private files can only
// be reached online, so there is nothing useful to cache offline.
export const dynamic = "force-dynamic";

const UNCATEGORISED = "Uncategorised";

function groupByCategory(
  docs: LibraryDocument[]
): { category: string; docs: LibraryDocument[] }[] {
  const groups: { category: string; docs: LibraryDocument[] }[] = [];
  const index = new Map<string, number>();
  for (const doc of docs) {
    const key = doc.category?.trim() || UNCATEGORISED;
    let at = index.get(key);
    if (at === undefined) {
      at = groups.length;
      index.set(key, at);
      groups.push({ category: key, docs: [] });
    }
    groups[at].docs.push(doc);
  }
  return groups;
}

export default async function LibraryPage() {
  const docs = await getLibraryDocuments();
  const groups = groupByCategory(docs);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900">Site folders</h1>
        <p className="text-sm text-gray-500">
          The library of documents for customer site folders. Download, email,
          or add to the print basket to have copies printed.
        </p>
      </header>

      <UploadPanel />

      {docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm font-medium text-gray-900">No documents yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Use &ldquo;Add document&rdquo; above to upload the first site-folder
            document.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.category} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {group.category}
              </h2>
              <div className="space-y-2">
                {group.docs.map((doc) => (
                  <LibraryDocumentRow key={doc.id} doc={doc} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <BasketBar />
    </div>
  );
}
