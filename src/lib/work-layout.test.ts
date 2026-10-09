/**
 * Work Overview's column layout (owner, Oct 7): the default order, drag to reorder, X to hide,
 * chips to restore, and the user's layout following them (browser copy + profile).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LIST_BUCKETS, type WorkBucket } from "./my-work";
import {
  DEFAULT_WORK_LAYOUT_ORDER,
  applyWorkLayout,
  defaultWorkLayout,
  hideBucket,
  isDefaultWorkLayout,
  moveBucket,
  normalizeWorkLayout,
  readStoredWorkLayout,
  showBucket,
  writeStoredWorkLayout,
  type WorkLayout,
} from "./work-layout";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const groups = (...b: WorkBucket[]) => b.map((bucket) => ({ bucket, n: 0 }));
const order = (l: WorkLayout) => l.order.join(",");

describe("the default layout", () => {
  it("is the owner's order: Unassigned, Overdue, This week, Later, Waiting, Needs authorization, No date, Done", () => {
    // Waiting (owner, Oct 9: a follow-up on hold) after Later, before No date.
    expect([...DEFAULT_WORK_LAYOUT_ORDER]).toEqual([
      "unassigned",
      "overdue",
      "week",
      "later",
      "waiting",
      "authorize",
      "nodate",
      "done",
    ]);
    expect(DEFAULT_WORK_LAYOUT_ORDER).toBe(LIST_BUCKETS);
    expect(isDefaultWorkLayout(defaultWorkLayout())).toBe(true);
  });
  it("whatever was stored is made whole", () => {
    expect(normalizeWorkLayout(null)).toEqual(defaultWorkLayout());
    expect(normalizeWorkLayout("junk")).toEqual(defaultWorkLayout());
    const partial = normalizeWorkLayout({
      order: ["done", "bogus", "done", "week"],
      hidden: ["nodate", "x"],
    });
    // A missing column takes its default place among the ones there (Oct 9): after the nearest
    // default predecessor present, else before the nearest default successor.
    expect(order(partial)).toBe("done,unassigned,overdue,week,later,waiting,authorize,nodate");
    expect(partial.hidden).toEqual(["nodate"]);
    expect(isDefaultWorkLayout(partial)).toBe(false);
  });
  it("a layout saved before Waiting existed gets it after Later, not at the end", () => {
    const saved = normalizeWorkLayout({
      order: ["unassigned", "overdue", "week", "later", "authorize", "nodate", "done"],
      hidden: ["authorize"],
    });
    expect(order(saved)).toBe("unassigned,overdue,week,later,waiting,authorize,nodate,done");
    expect(saved.hidden).toEqual(["authorize"]);
  });
});

describe("arranging the columns", () => {
  const all = groups(...LIST_BUCKETS);
  it("applies the order and sets the hidden ones aside for the restore chips", () => {
    const l: WorkLayout = {
      order: ["done", "unassigned", "overdue", "week", "later", "authorize", "nodate"],
      hidden: ["nodate", "authorize"],
    };
    const { shown, hidden } = applyWorkLayout(all, l);
    expect(shown.map((g) => g.bucket)).toEqual(["done", "unassigned", "overdue", "week", "later"]);
    expect(hidden.map((g) => g.bucket)).toEqual(["authorize", "nodate"]);
    // A group the list does not have (Needs authorization for a non-authorizer) is simply absent.
    const few = applyWorkLayout(groups("overdue", "week"), l);
    expect(few.shown.map((g) => g.bucket)).toEqual(["overdue", "week"]);
    expect(few.hidden).toEqual([]);
    // The ?bucket= preset's column stays shown even when hidden.
    const kept = applyWorkLayout(all, { ...l, hidden: ["overdue"] }, "overdue");
    expect(kept.shown.map((g) => g.bucket)).toContain("overdue");
    expect(kept.hidden).toEqual([]);
  });
  it("drag a heading onto another column: before one ahead of it, after one behind it", () => {
    const d = defaultWorkLayout();
    expect(order(moveBucket(d, "done", "unassigned"))).toBe(
      "done,unassigned,overdue,week,later,waiting,authorize,nodate",
    );
    expect(order(moveBucket(d, "unassigned", "done"))).toBe(
      "overdue,week,later,waiting,authorize,nodate,done,unassigned",
    );
    expect(order(moveBucket(d, "authorize", "overdue"))).toBe(
      "unassigned,authorize,overdue,week,later,waiting,nodate,done",
    );
    expect(order(moveBucket(d, "overdue", "later"))).toBe(
      "unassigned,week,later,overdue,waiting,authorize,nodate,done",
    );
    expect(moveBucket(d, "week", "week")).toBe(d);
  });
  it("the X hides a column, a chip brings it back, and the last column cannot be hidden", () => {
    let l = hideBucket(defaultWorkLayout(), "nodate");
    expect(l.hidden).toEqual(["nodate"]);
    expect(hideBucket(l, "nodate")).toBe(l);
    for (const b of [
      "unassigned",
      "overdue",
      "week",
      "later",
      "waiting",
      "authorize",
    ] as WorkBucket[])
      l = hideBucket(l, b);
    expect(l.hidden).toHaveLength(7);
    expect(hideBucket(l, "done")).toBe(l);
    expect(showBucket(l, "overdue").hidden).not.toContain("overdue");
    // Back comes "nodate" in its own place, not at the end.
    const back = showBucket(hideBucket(defaultWorkLayout(), "week"), "week");
    expect(back).toEqual(defaultWorkLayout());
  });
});

describe("the layout follows the user", () => {
  class FakeStorage {
    m = new Map<string, string>();
    getItem = (k: string) => this.m.get(k) ?? null;
    setItem = (k: string, v: string) => void this.m.set(k, v);
    removeItem = (k: string) => void this.m.delete(k);
  }
  it("is cached per user in the browser; the default clears the cache", () => {
    const s = new FakeStorage();
    const l = hideBucket(defaultWorkLayout(), "done");
    writeStoredWorkLayout(s, "u1", l);
    expect(readStoredWorkLayout(s, "u1")).toEqual(l);
    expect(readStoredWorkLayout(s, "u2")).toBeNull();
    writeStoredWorkLayout(s, "u1", defaultWorkLayout());
    expect(readStoredWorkLayout(s, "u1")).toBeNull();
    expect(readStoredWorkLayout(null, "u1")).toBeNull();
    s.setItem("jbk-portal:work-layout:u3", "{not json");
    expect(readStoredWorkLayout(s, "u3")).toBeNull();
  });
  it("and on the profile, written only through set_my_work_layout (the user's own row)", () => {
    const fn = read("./work-layout.functions.ts");
    expect(fn).toContain('.select("work_layout")');
    expect(fn).toContain('rpc("set_my_work_layout"');
    expect(fn).toContain("isDefaultWorkLayout(layout) ? null : toJson(layout)");
    const sql = read("../../supabase/migrations/20261007110000_work_layout.sql");
    expect(sql).toContain("add column if not exists work_layout jsonb");
    expect(sql).toContain("security definer");
    expect(sql).toContain("where id = auth.uid()");
    expect(sql).toContain(
      "grant execute on function public.set_my_work_layout(jsonb) to authenticated",
    );
    expect(read("../integrations/supabase/types.ts")).toContain("work_layout: Json | null;");
  });
  it("the page: drag the heading, X in the corner, Hidden chips, Reset layout, saved both places", () => {
    const page = read("../components/my-work-page.tsx");
    expect(page).toContain("applyWorkLayout(groups, layout, keep)");
    expect(page).toContain("onLayout(moveBucket(layout, dragging, target))");
    expect(page).toContain("draggable");
    expect(page).toContain("aria-label={`Hide ${g.label}`}");
    expect(page).toContain("onLayout(hideBucket(layout, g.bucket))");
    expect(page).toContain("onLayout(showBucket(layout, g.bucket))");
    expect(page).toContain("Reset layout");
    expect(page).toContain("onLayout(defaultWorkLayout())");
    expect(page).toContain("writeStoredWorkLayout(storage, userId, l)");
    expect(page).toContain("saveLayout.mutate(l)");
    expect(page).toContain("defaultBucket(shown, preset)");
  });
});
