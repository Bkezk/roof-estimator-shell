/**
 * Nov 23, the owner, on inspection #6077 (no pictures, made from no other ticket): "why is there
 * an option to add from ticket photos when theres not an associated ticket? that shouldn't be on
 * there if theres no associated ticket linked with that inspection. we should also be able to add
 * pictures to checked marked good items since we can then use that to generate the care plan
 * reports."
 *
 *  - "From ticket photos" offered the inspection's own pictures to another row. It was always
 *    drawn, greyed out when there was nothing to offer. Now it is drawn only when there is a
 *    picture to offer, and it says what it is: "From this inspection's other pictures (3)".
 *  - Every row could take pictures since Nov 20, but the button was a bare camera and was
 *    missed. It now says "Pictures", and "Pictures (2)" once the row has some.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  notify: async () => 1,
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
}));

import { ChecklistRows } from "@/components/service/inspection-section";
import {
  attachableTicketPhotos,
  OTHER_PICTURES_TITLE,
  otherPicturesWords,
  picturesButtonLabel,
  picturesButtonWords,
  pressStatus,
  rowPicturesOpen,
} from "@/lib/inspection";

const flat = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\s+/g, " ");

describe("the button that offers a row the inspection's other pictures", () => {
  it("says what it offers, with how many", () => {
    expect(otherPicturesWords(3)).toBe("From this inspection's other pictures (3)");
    expect(otherPicturesWords(1)).toBe("From this inspection's other pictures (1)");
    expect(OTHER_PICTURES_TITLE).toBe("This inspection's other pictures");
  });
  it("has no words when there is nothing to offer", () => {
    expect(otherPicturesWords(0)).toBeNull();
    expect(otherPicturesWords(null)).toBeNull();
    expect(otherPicturesWords(undefined)).toBeNull();
    expect(otherPicturesWords(-1)).toBeNull();
  });
  it("an inspection with no pictures, as #6077 was, offers none: no button", () => {
    expect(otherPicturesWords(attachableTicketPhotos([], "seams").length)).toBeNull();
    // Only a repair's pictures and the signature on the ticket: still nothing to offer.
    const photos = [
      { id: "p1", role: "before", repair_id: "r1", item_key: null, item_keys: [] },
      { id: "p2", role: "signature", repair_id: null, item_key: null, item_keys: [] },
    ];
    expect(otherPicturesWords(attachableTicketPhotos(photos, "seams").length)).toBeNull();
    // A picture already on this row is not offered to it again.
    const own = [
      { id: "p3", role: "other", repair_id: null, item_key: "seams", item_keys: ["seams"] },
    ];
    expect(otherPicturesWords(attachableTicketPhotos(own, "seams").length)).toBeNull();
    // The same picture is offered to another row.
    expect(otherPicturesWords(attachableTicketPhotos(own, "drains").length)).toBe(
      "From this inspection's other pictures (1)",
    );
  });
  it("is not drawn at all without words, and never greyed out", () => {
    const src = flat("src/components/service/inspection-item-photos.tsx");
    expect(src).toContain("const words = otherPicturesWords(pickable.length);");
    expect(src).toContain("if (!words && !open) return null;");
    expect(src).toContain("{words && ( <Button");
    expect(src).not.toContain("disabled={pickable.length === 0}");
    expect(src).not.toContain("From ticket photos");
    expect(src).toContain("<DialogTitle>{OTHER_PICTURES_TITLE}</DialogTitle>");
    expect(src).toContain("Pictures already on this inspection that are not on {itemLabel} yet.");
  });
  it("is a thumb tall and may take two lines on a narrow phone, so no word is cut", () => {
    const src = flat("src/components/service/inspection-item-photos.tsx");
    expect(src).toContain(
      '"h-auto min-h-[44px] max-w-full whitespace-normal px-3 py-1 text-left text-sm sm:min-h-10"',
    );
  });
  it("both screens still hand it the row and the inspection's pictures", () => {
    expect(flat("src/components/service/inspection-closeout.tsx")).toContain(
      "<FromTicketPhotosButton jobId={jobId} itemKey={itemKey} itemLabel={label} photos={allPhotos}",
    );
    expect(flat("src/components/service/inspection-item-photos.tsx")).toContain(
      "<FromTicketPhotosButton {...props} compact />",
    );
  });
});

describe("the Pictures button on every checklist row", () => {
  it("says Pictures, with the count once the row has some", () => {
    expect(picturesButtonWords(0)).toBe("Pictures");
    expect(picturesButtonWords(2)).toBe("Pictures (2)");
    expect(picturesButtonWords(null)).toBe("Pictures");
    expect(picturesButtonWords(undefined)).toBe("Pictures");
    expect(picturesButtonWords(-1)).toBe("Pictures");
    // What a screen reader hears is as it was.
    expect(picturesButtonLabel("Seams", 2)).toBe("Seams: pictures (2)");
    expect(picturesButtonLabel("Seams", 0)).toBe("Seams: add pictures");
  });
  it("drawn: a good row, an unanswered row and an issue row each carry the labelled button", () => {
    const items = [
      { id: "a", label: "Seams", status: "ok" as const, note: "" },
      { id: "b", label: "Drains/scuppers", status: null, note: "" },
      { id: "c", label: "Ponding", status: "issue" as const, note: "low spot" },
    ];
    const html = renderToStaticMarkup(
      createElement(ChecklistRows, {
        items,
        readOnly: false,
        onChange: () => {},
        extra: () => createElement("span", { "data-test": "extra" }, "camera here"),
        photoCount: (item) => (item.id === "a" ? 2 : 0),
      }),
    );
    const buttons = [
      ...html.matchAll(/<button[^>]*data-action="row-pictures"[^>]*>(.*?)<\/button>/g),
    ];
    expect(buttons).toHaveLength(3);
    const words = buttons.map((m) => m[1]!.replace(/<svg.*?<\/svg>/g, "").replace(/<[^>]+>/g, ""));
    expect(words).toEqual(["Pictures (2)", "Pictures", "Pictures"]);
    expect(buttons[0]![0]).toContain('aria-label="Seams: pictures (2)"');
    expect(buttons[1]![0]).toContain('aria-label="Drains/scuppers: add pictures"');
    // The good row stays good, shows its pictures' panel without a press, and has no note box.
    const rows = html.split("<li").slice(1);
    expect(rows[0]).toContain('data-row="ok"');
    expect(rows[0]).toContain("camera here");
    expect(rows[0]).not.toContain("What and where");
    // A row with no pictures stays closed until its button is pressed.
    expect(rows[1]).not.toContain("camera here");
    // Only the issue row asks for a note.
    expect(rows[2]).toContain("What and where");
    // Without the pictures' tools (no `extra`) there is no button at all.
    expect(
      renderToStaticMarkup(
        createElement(ChecklistRows, { items, readOnly: false, onChange: () => {} }),
      ),
    ).not.toContain('data-action="row-pictures"');
  });
  it("is drawn with its words, an outline and a thumb's height", () => {
    const src = flat("src/components/service/inspection-section.tsx");
    expect(src).toContain(
      '<span data-line="row-pictures-words">{picturesButtonWords(pictures)}</span>',
    );
    const at = src.indexOf('data-action="row-pictures"');
    const button = src.slice(src.lastIndexOf("<Button", at), src.indexOf("</Button>", at));
    expect(button).toContain('variant="outline"');
    expect(button).toContain("h-[44px] min-w-[44px] gap-1 px-2 text-xs");
    expect(button).toContain("aria-label={picturesButtonLabel(item.label, pictures)}");
    expect(button).toContain("aria-expanded={picsOpen}");
    expect(button).toContain("data-count={pictures}");
    // On every row a person may edit, whatever its answer; a reader sees it where there are some.
    expect(src).toContain("const picsButton = !!extra && (!readOnly || pictures > 0);");
  });
  it("the row wraps by itself: the label keeps its room, the buttons go under it to the right", () => {
    const src = flat("src/components/service/inspection-section.tsx");
    expect(src).toContain(
      '<div className="flex flex-wrap items-center gap-1" data-line="checklist-row">',
    );
    expect(src).toContain(
      'className="flex min-h-10 min-w-[9.5rem] flex-1 items-center gap-2 rounded-md px-1 text-left font-medium disabled:cursor-default"',
    );
    expect(src).toContain(
      'className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-0.5"',
    );
    // A label breaks after its slash or between words, never inside a word that fits.
    expect(src).toContain("min-w-0 [overflow-wrap:break-word]");
    expect(src).not.toContain("[overflow-wrap:anywhere]");
    expect(src).toContain("/<wbr />");
    expect(src).not.toContain("shrink-0 items-center gap-0.5");
  });
  it("a press on it never touches a good row's answer and asks for no note", () => {
    const src = flat("src/components/service/inspection-section.tsx");
    const press = src.slice(
      src.indexOf("const pressPictures = () => {"),
      src.indexOf("const set = ("),
    );
    // Screen state only: no onChange, so nothing is saved by the press.
    expect(press).not.toContain("onChange(");
    expect(press).toContain("setPicsPressed((prev) => new Map(prev).set(item.id, !picsOpen));");
    // The note box belongs to an issue row alone.
    expect(src).toContain("{flagged && !closed ? (");
    // A good row with pictures shows them without a press; one with none stays one line.
    expect(rowPicturesOpen({ flagged: false, folded: false, pressed: undefined, count: 2 })).toBe(
      true,
    );
    expect(rowPicturesOpen({ flagged: false, folded: false, pressed: undefined, count: 0 })).toBe(
      false,
    );
    expect(rowPicturesOpen({ flagged: false, folded: false, pressed: true, count: 0 })).toBe(true);
    // Ticking good again on a good row clears the tick, as before: the pictures play no part.
    expect(pressStatus("ok", "ok")).toEqual({ status: null, fold: false });
  });
});
