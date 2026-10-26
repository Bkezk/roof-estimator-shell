/**
 * Admin › Documents' pure parts (admin-helpers.ts): the templates grouped per kind with the
 * default first, the PDF library's size column, and what stops an upload before it is read.
 */
import { describe, expect, it } from "vitest";

import {
  KIND_TITLES,
  MAX_PDF_BYTES,
  assetNameFromFile,
  base64FromDataUrl,
  formatBytes,
  groupTemplatesByKind,
  pdfUploadProblem,
  templateEditorHref,
} from "./admin-helpers";
import { DOC_KINDS } from "./model";

describe("groupTemplatesByKind", () => {
  const t = (kind: "bid" | "ticket", name: string, is_default = false) => ({
    kind,
    name,
    is_default,
  });

  it("gives every kind a table, in the model's order, even with no templates", () => {
    const groups = groupTemplatesByKind([]);
    expect(groups.map((g) => g.kind)).toEqual([...DOC_KINDS]);
    expect(groups.every((g) => g.templates.length === 0)).toBe(true);
    expect(Object.keys(KIND_TITLES).sort()).toEqual([...DOC_KINDS].sort());
  });

  it("puts the default first, then the rest by name, within each kind", () => {
    const groups = groupTemplatesByKind([
      t("ticket", "Warranty letter"),
      t("bid", "Zed cover letter"),
      t("bid", "Proposal", true),
      t("bid", "award letter"),
      t("ticket", "Inspection report", true),
    ]);
    expect(groups[0]!.kind).toBe("bid");
    expect(groups[0]!.templates.map((x) => x.name)).toEqual([
      "Proposal",
      "award letter",
      "Zed cover letter",
    ]);
    expect(groups[1]!.templates.map((x) => x.name)).toEqual([
      "Inspection report",
      "Warranty letter",
    ]);
  });
});

describe("formatBytes", () => {
  it("reads as people do", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(25_088)).toBe("25 KB");
    expect(formatBytes(5_120)).toBe("5.0 KB");
    expect(formatBytes(512_000)).toBe("500 KB");
    expect(formatBytes(1_258_291)).toBe("1.2 MB");
    expect(formatBytes(MAX_PDF_BYTES)).toBe("20.0 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
});

describe("pdfUploadProblem", () => {
  it("takes a PDF by type or by name, up to 20 MB", () => {
    expect(pdfUploadProblem({ name: "spec.pdf", type: "application/pdf", size: 1000 })).toBeNull();
    expect(pdfUploadProblem({ name: "SPEC.PDF", type: "", size: 1000 })).toBeNull();
    expect(
      pdfUploadProblem({ name: "spec", type: "application/pdf", size: MAX_PDF_BYTES }),
    ).toBeNull();
  });
  it("refuses other files, empty files and anything over 20 MB, saying why", () => {
    expect(pdfUploadProblem({ name: "photo.jpg", type: "image/jpeg", size: 1000 })).toMatch(
      /Only a PDF/,
    );
    expect(pdfUploadProblem({ name: "spec.pdf", type: "application/pdf", size: 0 })).toMatch(
      /empty/,
    );
    const big = pdfUploadProblem({
      name: "spec.pdf",
      type: "application/pdf",
      size: MAX_PDF_BYTES + 1,
    });
    expect(big).toMatch(/20 MB/);
    expect(big).toMatch(/20\.0 MB/);
  });
});

describe("the upload's name and body", () => {
  it("names the asset after the file without .pdf, never blank", () => {
    expect(assetNameFromFile("Award letter.pdf")).toBe("Award letter");
    expect(assetNameFromFile("  spec.PDF ")).toBe("spec");
    expect(assetNameFromFile(".pdf")).toBe("PDF");
  });
  it("takes the base64 body off a data: URL and leaves a bare string alone", () => {
    expect(base64FromDataUrl("data:application/pdf;base64,JVBERi0x")).toBe("JVBERi0x");
    expect(base64FromDataUrl("JVBERi0x")).toBe("JVBERi0x");
  });
});

describe("templateEditorHref", () => {
  it("opens a template, or a fresh one of a kind, in the editor", () => {
    expect(templateEditorHref({ id: "abc-123" })).toBe("/documents?template=abc-123");
    expect(templateEditorHref({ kind: "ticket" })).toBe("/documents?template=new&kind=ticket");
  });
});
