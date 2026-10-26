/**
 * The pure parts of Admin › Documents (routes/admin.documents.tsx): the templates grouped per
 * kind for the two tables, the PDF library's size column, and the checks an upload goes through
 * before it is read (PDF only, 20 MB at most). No React, no server — tested on their own
 * (admin-helpers.test.ts).
 */
import { DOC_KINDS, type DocKind } from "./model";

/** The two tables' headings, in the page's order (bids first: the proposals). */
export const KIND_TITLES: Record<DocKind, string> = {
  bid: "Bid documents",
  ticket: "Ticket documents",
};

/** What a template of this kind hangs off, for the New template picker. */
export const KIND_HELP: Record<DocKind, string> = {
  bid: "Proposals and letters made from a bid (the estimator, the Project Bids list)",
  ticket: "Reports and letters made from a service ticket",
};

/**
 * Templates grouped by kind, every kind present (an empty list shows the hint that the server
 * seeds the defaults the first time a document of that kind is made). Within a kind the default
 * comes first, then by name, so the star is always at the top of its table.
 */
export function groupTemplatesByKind<
  T extends { kind: DocKind; name: string; is_default: boolean },
>(templates: readonly T[]): Array<{ kind: DocKind; templates: T[] }> {
  return DOC_KINDS.map((kind) => ({
    kind,
    templates: templates
      .filter((t) => t.kind === kind)
      .sort((a, b) =>
        a.is_default !== b.is_default
          ? a.is_default
            ? -1
            : 1
          : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
  }));
}

/** A byte count as people read it: "0 B", "812 B", "24.5 KB", "1.2 MB" (one decimal above KB). */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** The PDF library's upload ceiling (the server stores the file in a bucket; a spec sheet fits). */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Why a picked file cannot go into the PDF library, or null when it can: a PDF by type or by
 * `.pdf` name (browsers do not always set the type), at most 20 MB, not empty.
 */
export function pdfUploadProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return "Only a PDF can go into the library";
  if (file.size <= 0) return "This file is empty";
  if (file.size > MAX_PDF_BYTES)
    return `This PDF is ${formatBytes(file.size)}; the most that can be uploaded is 20 MB`;
  return null;
}

/** The library name of an uploaded file: its name without the .pdf, trimmed, never blank. */
export function assetNameFromFile(fileName: string): string {
  const name = fileName.trim().replace(/\.pdf$/i, "");
  return name || "PDF";
}

/** The base64 body of a data: URL (what FileReader.readAsDataURL gives), or the string itself. */
export function base64FromDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 && dataUrl.startsWith("data:") ? dataUrl.slice(i + 1) : dataUrl;
}

/**
 * The editor's address for a template (Edit) or a fresh one of a kind (New template). A built
 * href (router.navigate({ href }), as the global search does): the /documents route is the
 * editor builder's, so it is not in this file's route tree to type against.
 */
export function templateEditorHref(target: { id: string } | { kind: DocKind }): string {
  return "id" in target
    ? `/documents?template=${encodeURIComponent(target.id)}`
    : `/documents?template=new&kind=${target.kind}`;
}
