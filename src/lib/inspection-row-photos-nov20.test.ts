/**
 * Owner, Nov 20: "for the inspections we need to be able to add pictures even if the section is
 * good and has a checkmark, it needs to be available via opening the camera or from camera roll
 * just like the repairs are."
 *
 * Until now a checklist row showed its pictures and its camera only while it was flagged an
 * issue. Every row now ends with a Pictures button; on a row that is not an issue it opens the
 * same camera, From my photos and thumbnails an issue row has, with no note asked and the row's
 * answer left alone. A row that has pictures shows them without a press.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { ChecklistRows } from "@/components/service/inspection-section";
import {
  photosOnItem,
  picturesButtonLabel,
  rowPicturesOpen,
  type InspectionItem,
} from "@/lib/inspection";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const ITEMS: InspectionItem[] = [
  { id: "seams", label: "Seams", status: "ok", note: "" },
  { id: "drains", label: "Drains/scuppers", status: null, note: "" },
  { id: "debris", label: "Debris", status: "na", note: "" },
  { id: "flash", label: "Flashings", status: "issue", note: "Lifting at the curb" },
  { id: "ponding", label: "Ponding", status: null, note: "" },
];
/** Seams (good) has two pictures, Debris (N/A) one, Ponding (no answer) one; the rest none. */
const COUNTS: Record<string, number> = { seams: 2, debris: 1, ponding: 1 };
const render = (over: Partial<Parameters<typeof ChecklistRows>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ChecklistRows, {
      items: ITEMS,
      readOnly: false,
      onChange: () => {},
      photoCount: (item: InspectionItem) => COUNTS[item.id] ?? 0,
      extra: (item: InspectionItem) =>
        createElement("span", { "data-extra": item.id }, `pictures of ${item.label}`),
      ...over,
    }),
  );
/** One row's own markup. */
const rowOf = (html: string, label: string) => {
  const rows = html.split("<li ").slice(1);
  const hit = rows.find((r) => r.includes(`aria-label="${label}: result"`));
  if (!hit) throw new Error(`no row ${label}`);
  return hit;
};

describe("when a row's pictures show", () => {
  it("a row that is not an issue: what was pressed, else open with pictures and shut with none", () => {
    const row = { flagged: false, folded: false };
    expect(rowPicturesOpen({ ...row, pressed: undefined, count: 0 })).toBe(false);
    expect(rowPicturesOpen({ ...row, pressed: undefined, count: 2 })).toBe(true);
    expect(rowPicturesOpen({ ...row, pressed: true, count: 0 })).toBe(true);
    expect(rowPicturesOpen({ ...row, pressed: false, count: 2 })).toBe(false);
  });
  it("an issue row keeps its pictures in its own fold", () => {
    expect(rowPicturesOpen({ flagged: true, folded: false, pressed: false, count: 0 })).toBe(true);
    expect(rowPicturesOpen({ flagged: true, folded: true, pressed: true, count: 3 })).toBe(false);
  });
  it("the button is named for a screen reader", () => {
    expect(picturesButtonLabel("Seams", 0)).toBe("Seams: add pictures");
    expect(picturesButtonLabel("Seams", 2)).toBe("Seams: pictures (2)");
  });
});

describe("every checklist row has a Pictures button", () => {
  const html = render();
  it("one per row, with the row's count", () => {
    expect(html.match(/data-action="row-pictures"/g)).toHaveLength(ITEMS.length);
    expect(rowOf(html, "Seams")).toContain('data-count="2"');
    expect(rowOf(html, "Seams")).toContain('aria-label="Seams: pictures (2)"');
    expect(rowOf(html, "Drains/scuppers")).toContain('data-count="0"');
    expect(rowOf(html, "Drains/scuppers")).toContain('aria-label="Drains/scuppers: add pictures"');
  });
  it("a good row (the check mark) with pictures shows them, stays good and asks for no note", () => {
    const seams = rowOf(html, "Seams");
    expect(seams).toContain('data-row="ok"');
    expect(seams).toContain('data-row-pictures="seams"');
    expect(seams).toContain('data-extra="seams"');
    expect(seams).not.toContain('aria-label="Seams: note"');
    expect(seams).toContain('aria-expanded="true"');
  });
  it("an N/A row and a row with no answer show theirs the same way", () => {
    expect(rowOf(html, "Debris")).toContain('data-row="na"');
    expect(rowOf(html, "Debris")).toContain('data-extra="debris"');
    expect(rowOf(html, "Ponding")).toContain('data-row="clear"');
    expect(rowOf(html, "Ponding")).toContain('data-extra="ponding"');
    expect(rowOf(html, "Ponding")).not.toContain('aria-label="Ponding: note"');
  });
  it("a row with no pictures stays one line until its button is pressed", () => {
    const drains = rowOf(html, "Drains/scuppers");
    expect(drains).not.toContain("data-row-pictures");
    expect(drains).not.toContain("data-extra");
    expect(drains).toContain('aria-expanded="false"');
  });
  it("an issue row is as it was: its note and its pictures in its fold, once", () => {
    const flash = rowOf(html, "Flashings");
    expect(flash).toContain('data-row="issue"');
    expect(flash).toContain('aria-label="Flashings: note"');
    expect(flash.match(/data-extra="flash"/g)).toHaveLength(1);
    expect(flash).not.toContain("data-row-pictures");
  });
  it("somebody who cannot edit sees the button only where there are pictures to look at", () => {
    const locked = render({ readOnly: true });
    expect(locked.match(/data-action="row-pictures"/g)).toHaveLength(3);
    expect(rowOf(locked, "Seams")).toContain('data-extra="seams"');
    expect(rowOf(locked, "Drains/scuppers")).not.toContain("row-pictures");
  });
  it("a checklist with no pictures to offer (no `extra`) has no button at all", () => {
    expect(render({ extra: undefined })).not.toContain("row-pictures");
  });
});

describe("the press never touches the row's answer", () => {
  const src = flat("src/components/service/inspection-section.tsx");
  it("the Pictures button opens and folds; it never calls the row's change", () => {
    const start = src.indexOf("const pressPictures = () => {");
    const press = src.slice(start, src.indexOf("const set = (", start));
    expect(press.length).toBeGreaterThan(50);
    expect(press).not.toContain("onChange(");
    expect(press).toContain("setPicsPressed((prev) => new Map(prev).set(item.id, !picsOpen));");
    expect(press).toContain("if (closed) toggleFold(item.id);");
  });
  it("the pictures of a row that is not an issue come with no note box", () => {
    expect(src).toContain(
      '{!flagged && extra && picsOpen && ( // A row that is not an issue: its pictures and the two ways to add one, and no // note box. Nothing here changes the row\'s answer. <div className="pb-1" data-row-pictures={item.id}> {extra(item)} </div> )}',
    );
  });
  it("the server puts a picture on a row whatever the row's answer is", () => {
    const fn = read("src/lib/service-field.functions.ts");
    const register = fn.slice(
      fn.indexOf("export const registerJobPhoto"),
      fn.indexOf("export const", fn.indexOf("export const registerJobPhoto") + 10),
    );
    expect(register).toContain("const itemKeys = registrationItemKeys(data);");
    expect(register).not.toMatch(/isFlagged|status\s*===\s*"issue"/);
  });
});

describe("the two ways to add one, as the repairs have", () => {
  it("the technician's row: the camera, and pictures already on the phone", () => {
    const roll = flat("src/components/service/inspection-closeout.tsx");
    expect(roll).toContain("onClick={camera.onPhoto}");
    expect(roll).toContain('data-line="from-my-photos" onClick={camera.onPick}');
    expect(roll).toContain(
      "photoCount={(item) => itemPhotos(photos, item.id).length + camera.controls(item.id).pending.length }",
    );
    // A thumb in the row, as the repairs' camera buttons are.
    expect(roll).toContain('className={compact ? "h-[44px] px-3 text-sm" : "h-11 text-base"}');
    const cam = read("src/components/service/inspection-camera.ts");
    expect(cam).toContain('capture: "environment",');
    expect(cam).toContain("multiple: true,");
    // The repairs' own two ways, for comparison: the same pair.
    const repairs = flat("src/components/service/closeout.tsx");
    expect(repairs).toContain("onClick={() => onPhoto(role)}");
    expect(repairs).toContain("onClick={() => onPick(role)}");
  });
  it("the office's row: Add pictures and From ticket photos, with the row's count", () => {
    const section = flat("src/components/service/inspection-section.tsx");
    expect(section).toContain(
      "photoCount={(item) => photosOnItem(photos.data ?? [], item.id).length}",
    );
    const tools = flat("src/components/service/inspection-item-photos.tsx");
    expect(tools).toContain(
      'className={compact ? "h-[44px] px-3 text-sm sm:h-10" : "h-11 text-base"}',
    );
  });
  it("a row's pictures are found by the row, not by its answer", () => {
    const photos = [
      { id: "p1", role: "other", repair_id: null, item_key: "seams", item_keys: ["seams"] },
      { id: "p2", role: "other", repair_id: null, item_key: null, item_keys: [] },
      { id: "p3", role: "before", repair_id: "r1", item_key: null, item_keys: [] },
    ];
    expect(photosOnItem(photos, "seams").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("the row still fits a phone with its fourth button", () => {
  const src = flat("src/components/service/inspection-section.tsx");
  it("the label may narrow and break after a slash on any phone; the buttons are a thumb", () => {
    expect(src).toContain("max-sm:min-w-0 max-sm:[overflow-wrap:anywhere]");
    expect(src).toContain('<wbr className="sm:hidden" />');
    expect(src).toContain('className="flex items-center gap-1 max-[389px]:flex-wrap"');
    expect(src).toContain("h-[44px] min-w-[44px] gap-0.5 px-1.5");
  });
});
