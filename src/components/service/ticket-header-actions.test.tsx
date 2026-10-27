/**
 * The ticket header's icon buttons (owner, Oct 27: "make the trashcan just a trash icon and then
 * make the documents the document icon to the left of it instead of it being a whole new row
 * menu"). Rendered to a string (react-dom/server) — the component is presentational — and the
 * page's source pinned: no Documents fold in the aside any more.
 */
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TicketHeaderActions } from "./ticket-header-actions";

const noop = () => {};
const buttons = (html: string) => html.match(/<button\b[^>]*>/g) ?? [];

describe("TicketHeaderActions", () => {
  it("renders Delete as a trash icon alone — no 'Delete' text", () => {
    const html = renderToString(<TicketHeaderActions documents={null} onDelete={noop} />);
    const [del] = buttons(html);
    expect(del).toContain('aria-label="Delete ticket"');
    expect(del).toContain('title="Delete this ticket"');
    expect(del).toContain("text-destructive");
    expect(html).toMatch(/class="[^"]*lucide-trash-?2/);
    expect(html).not.toMatch(/>\s*Delete\s*</);
    expect(buttons(html)).toHaveLength(1);
  });
  it("puts the Documents icon immediately to the LEFT of Delete", () => {
    const html = renderToString(
      <TicketHeaderActions documents={{ count: 0, onOpen: noop }} onDelete={noop} />,
    );
    const [docs, del, ...rest] = buttons(html);
    expect(rest).toHaveLength(0);
    expect(docs).toContain('aria-label="Documents"');
    expect(docs).toContain('aria-haspopup="dialog"');
    expect(docs).toContain('title="Documents — reports and letters made from this ticket"');
    expect(del).toContain('aria-label="Delete ticket"');
    expect(html.indexOf('aria-label="Documents"')).toBeLessThan(
      html.indexOf('aria-label="Delete ticket"'),
    );
    expect(html).toMatch(/class="[^"]*lucide-file-text/);
    // No count: no badge.
    expect(html).not.toContain("data-documents-count");
  });
  it("wears the ticket's document count when it has any", () => {
    const html = renderToString(
      <TicketHeaderActions documents={{ count: 3, onOpen: noop }} onDelete={null} />,
    );
    expect(html).toContain('data-documents-count="3"');
    expect(html).toContain('title="Documents (3) — reports and letters made from this ticket"');
    expect(buttons(html)).toHaveLength(1); // no Delete for someone who is not a manager
    expect(html).not.toContain('aria-label="Delete ticket"');
  });
  it("renders nothing for a technician (no Documents, no Delete)", () => {
    expect(renderToString(<TicketHeaderActions documents={null} onDelete={null} />)).toBe("");
  });
});

describe("the ticket page (service-page.tsx)", () => {
  const page = readFileSync("src/components/service-page.tsx", "utf8");
  it("renders the header actions where Delete was, Documents for the office and Delete for a manager", () => {
    expect(page).toContain("<TicketHeaderActions");
    expect(page).toMatch(/onDelete=\{manager \? \(\) => setConfirmDelete\(true\) : null\}/);
    expect(page).toMatch(/documents=\{\s*officeOrAdmin\s*\?/);
    expect(page).toMatch(/<TicketDocumentsDialog\s+job=\{job\}/);
  });
  it("has no Documents fold in the aside any more", () => {
    expect(page).not.toContain("TicketDocumentsFold");
    expect(page).not.toContain('storageKey="documents"');
    expect(page).not.toMatch(/<DocumentsList\b/);
  });
  it("keeps the other folds' remembered state (storageKey) untouched", () => {
    expect(readFileSync("src/components/service/ticket-field-sections.tsx", "utf8")).toContain(
      'storageKey="repairs"',
    );
    expect(page).toContain("<FoldAllContext.Provider");
  });
});
