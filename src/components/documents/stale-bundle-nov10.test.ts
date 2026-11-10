/**
 * Nov 10, urgent: "Not saved: you saved this document from another tab at 11:25 AM after you
 * opened it" with one person and one tab. The editor kept an opened document's bundle in memory
 * for five minutes after it closed and never rewrote it on a save, so leaving the document and
 * opening it again showed the copy from BEFORE the last save, at its old version; every save
 * from that copy was refused as stale. Browser proof (read-only): on the old code coming back to
 * a document made 0 reads of it; now it makes 1.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DOCUMENT_BUNDLE_GC_MS } from "./document-types";

const route = readFileSync("src/routes/documents.tsx", "utf8").replace(/\s+/g, " ");

describe("an opened document is always read from the row", () => {
  it("its bundle is not kept once the editor closes", () => {
    expect(DOCUMENT_BUNDLE_GC_MS).toBe(0);
    const loader = route.slice(
      route.indexOf("function DocumentEditorLoader("),
      route.indexOf("function DocumentEditor("),
    );
    expect(loader).toContain("queryKey: documentKey(id),");
    expect(loader).toContain("gcTime: DOCUMENT_BUNDLE_GC_MS,");
  });

  it("a failed re-read never takes the open editor off the screen", () => {
    const loader = route.slice(
      route.indexOf("function DocumentEditorLoader("),
      route.indexOf("function DocumentEditor("),
    );
    expect(loader).toContain("if (!q.data) return (");
    expect(loader).not.toContain("if (q.isError || !q.data)");
  });
});
