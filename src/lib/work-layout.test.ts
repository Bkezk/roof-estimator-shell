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
  it("is the owner's order: Unassigned, Overdue, This week, Later, Waiting, Needs authorization, Authorized — to invoice", () => {
    // Waiting (owner, Oct 9: a follow-up on hold) after Later; "Authorized — to invoice" (owner,
    // Oct 12) right after Needs authorization; No date and Done gone (owner, Oct 12: an undated
    // item sits under Later, a Done ticket is not listed).
    expect([...DEFAULT_WORK_LAYOUT_ORDER]).toEqual([
      "unassigned",
      "overdue",
      "week",
      "later",
      "waiting",
      "authorize",
      "invoice",
    ]);
    expect(DEFAULT_WORK_LAYOUT_ORDER).toBe(LIST_BUCKETS);
    expect(isDefaultWorkLayout(defaultWorkLayout())).toBe(true);
  });
  it("whatever was stored is made whole", () => {
    expect(normalizeWorkLayout(null)).toEqual(defaultWorkLayout());
    expect(normalizeWorkLayout("junk")).toEqual(defaultWorkLayout());
    const partial = normalizeWorkLayout({
      order: ["invoice", "bogus", "done", "invoice", "week"],
      hidden: ["waiting", "x"],
    });
    // A missing column takes its default place among the ones there (Oct 9): after the nearest
    // default predecessor present, else before the nearest default successor. ("done", a group
    // that is gone, is an unknown name like "bogus".)
    expect(order(partial)).toBe("invoice,unassigned,overdue,week,later,waiting,authorize");
    expect(partial.hidden).toEqual(["waiting"]);
    expect(isDefaultWorkLayout(partial)).toBe(false);
  });
  it("a layout saved before Waiting existed gets it after Later, not at the end", () => {
    const saved = normalizeWorkLayout({
      order: ["unassigned", "overdue", "week", "later", "authorize", "nodate", "done"],
      hidden: ["authorize"],
    });
    // ("nodate" and "done", the groups removed Oct 12, are dropped like any unknown name.)
    expect(order(saved)).toBe("unassigned,overdue,week,later,waiting,authorize,invoice");
    expect(saved.hidden).toEqual(["authorize"]);
  });
  it("a layout saved before Authorized — to invoice existed gets it after Needs authorization (Oct 12)", () => {
    const saved = normalizeWorkLayout({
      order: ["unassigned", "overdue", "week", "later", "waiting", "authorize", "nodate", "done"],
      hidden: ["waiting"],
    });
    expect(order(saved)).toBe("unassigned,overdue,week,later,waiting,authorize,invoice");
    expect(saved.hidden).toEqual(["waiting"]);
    // Needs authorization moved to the front: the new column follows it there.
    const moved = normalizeWorkLayout({
      order: ["authorize", "unassigned", "overdue", "week", "later", "waiting", "nodate", "done"],
      hidden: [],
    });
    expect(order(moved)).toBe("authorize,invoice,unassigned,overdue,week,later,waiting");
  });
});

describe("arranging the columns", () => {
  const all = groups(...LIST_BUCKETS);
  it("applies the order and sets the hidden ones aside for the restore chips", () => {
    const l: WorkLayout = {
      order: ["invoice", "unassigned", "overdue", "week", "later", "authorize", "waiting"],
      hidden: ["waiting", "authorize"],
      hiddenKinds: [],
    };
    const { shown, hidden } = applyWorkLayout(all, l);
    expect(shown.map((g) => g.bucket)).toEqual([
      "invoice",
      "unassigned",
      "overdue",
      "week",
      "later",
    ]);
    expect(hidden.map((g) => g.bucket)).toEqual(["authorize", "waiting"]);
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
    expect(order(moveBucket(d, "invoice", "unassigned"))).toBe(
      "invoice,unassigned,overdue,week,later,waiting,authorize",
    );
    expect(order(moveBucket(d, "unassigned", "invoice"))).toBe(
      "overdue,week,later,waiting,authorize,invoice,unassigned",
    );
    expect(order(moveBucket(d, "authorize", "overdue"))).toBe(
      "unassigned,authorize,overdue,week,later,waiting,invoice",
    );
    expect(order(moveBucket(d, "overdue", "later"))).toBe(
      "unassigned,week,later,overdue,waiting,authorize,invoice",
    );
    expect(moveBucket(d, "week", "week")).toBe(d);
  });
  it("the X hides a column, a chip brings it back, and the last column cannot be hidden", () => {
    let l = hideBucket(defaultWorkLayout(), "waiting");
    expect(l.hidden).toEqual(["waiting"]);
    expect(hideBucket(l, "waiting")).toBe(l);
    for (const b of ["unassigned", "overdue", "week", "later", "authorize"] as WorkBucket[])
      l = hideBucket(l, b);
    expect(l.hidden).toHaveLength(6);
    expect(hideBucket(l, "invoice")).toBe(l);
    expect(showBucket(l, "overdue").hidden).not.toContain("overdue");
    // Back comes "week" in its own place, not at the end.
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
    const l = hideBucket(defaultWorkLayout(), "invoice");
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
    // Oct 15: null only when there is nothing at all to keep (a remembered view counts).
    expect(fn).toContain("isEmptyWorkLayout(layout) ? null : toJson(layout)");
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
