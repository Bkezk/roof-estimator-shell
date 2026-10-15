/**
 * Work Overview remembers more than the columns (owner, Oct 15):
 *
 * 1. Bug: the Show kinds were never saved. toJson and the zod schema in work-layout.functions.ts
 *    dropped hiddenKinds, so set_my_work_layout got {order, hidden}, the next load read
 *    hiddenKinds: [] and the mount effect wrote that over the browser's copy. "Remembered for you
 *    on every device" was false. Fails on the old code: the saved JSON has no hiddenKinds.
 * 2. The view (List / Calendar / Owner) and whose work (?who= form) ride on the same layout. When
 *    the URL is silent (the sidebar's link, the sign-in landing) the remembered ones apply
 *    (landingSearch); the URL wins when it speaks. Neither counts as a column customisation
 *    (isDefaultWorkLayout: no Reset button, no chips), but both are kept (isEmptyWorkLayout).
 * 3. The profile's copy rides on listMyWork and seeds the cache only when the cache is empty or
 *    older than LAYOUT_SEED_STALE_MS (shouldSeedWorkLayout), so a list fetched before a save
 *    committed cannot put the old layout back.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { effectiveView } from "@/lib/owner-view";
import {
  LAYOUT_SEED_STALE_MS,
  defaultWorkLayout,
  hideBucket,
  isDefaultWorkLayout,
  isEmptyWorkLayout,
  keepRemembered,
  landingSearch,
  normalizeWorkLayout,
  readStoredWorkLayout,
  rememberView,
  rememberWho,
  shouldSeedWorkLayout,
  toggleKind,
  writeStoredWorkLayout,
  type WorkLayout,
} from "@/lib/work-layout";
import { getMyWorkLayout, setMyWorkLayout } from "@/lib/work-layout.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** setMyWorkLayout through the stand-in; `written` is what set_my_work_layout was handed. */
async function save(data: unknown) {
  let written: unknown = "never called";
  const env = fakeSupabase(
    { profiles: [{ id: ME }] },
    {
      rpc: (fn, args) => {
        if (fn !== "set_my_work_layout") return undefined;
        written = args?.["p_layout"];
        return { data: null, error: null };
      },
    },
  );
  const r = await (
    setMyWorkLayout as unknown as (a: { data: unknown; context: unknown }) => Promise<Row>
  )({ data, context: { supabase: env.db, userId: ME } });
  return { r, written: written as Row | null };
}
const load = (work_layout: unknown) =>
  (getMyWorkLayout as unknown as (a: { data: unknown; context: unknown }) => Promise<Row>)({
    data: undefined,
    context: { supabase: fakeSupabase({ profiles: [{ id: ME, work_layout }] }).db, userId: ME },
  });

describe("bug: the Show kinds reach the profile", () => {
  it("setMyWorkLayout hands set_my_work_layout the hiddenKinds (the old toJson dropped them)", async () => {
    const l = toggleKind(toggleKind(defaultWorkLayout(), "bid"), "ticket");
    const { r, written } = await save(l);
    expect(r).toEqual({ saved: true });
    expect(written).toMatchObject({ hiddenKinds: ["bid", "ticket"] });
    expect(written).toMatchObject({ order: l.order, hidden: [] });
  });
  it("and reads them back whole: the saved JSON round-trips through getMyWorkLayout", async () => {
    const l = toggleKind(hideBucket(defaultWorkLayout(), "invoice"), "bid");
    const { written } = await save(l);
    const back = await load(written);
    expect(back).toEqual({ layout: l });
  });
  it("a layout that is default in every way is saved as null (the column's 'default' value)", async () => {
    expect((await save(defaultWorkLayout())).written).toBeNull();
    expect((await save({ order: [], hidden: [] })).written).toBeNull();
  });
  it("set_my_work_layout takes any jsonb object (no shape check), so no migration is needed", () => {
    const sql = readFileSync("supabase/migrations/20261007110000_work_layout.sql", "utf8");
    expect(sql).toContain("public.set_my_work_layout(p_layout jsonb)");
    expect(sql).toContain("jsonb_typeof(p_layout) <> 'object'");
    expect(sql).toContain("length(p_layout::text) > 2000");
    // No key is named, checked or stripped.
    expect(sql).not.toMatch(/p_layout\s*->|p_layout\s*\?|jsonb_object_keys|'hidden'|'order'/);
  });
});

describe("the remembered view and person on the layout", () => {
  it("normalize: calendar / owner kept, list (the default) and junk dropped; who a short string", () => {
    expect(normalizeWorkLayout({ view: "calendar" }).view).toBe("calendar");
    expect(normalizeWorkLayout({ view: "owner" }).view).toBe("owner");
    expect(normalizeWorkLayout({ view: "list" })).not.toHaveProperty("view");
    expect(normalizeWorkLayout({ view: "kanban" })).not.toHaveProperty("view");
    expect(normalizeWorkLayout({ who: "mine" }).who).toBe("mine");
    expect(normalizeWorkLayout({ who: PAT }).who).toBe(PAT);
    expect(normalizeWorkLayout({ who: "" })).not.toHaveProperty("who");
    expect(normalizeWorkLayout({ who: 7 })).not.toHaveProperty("who");
    expect(normalizeWorkLayout({ who: "x".repeat(65) })).not.toHaveProperty("who");
    // The old shape still reads as the default.
    expect(normalizeWorkLayout({ order: [], hidden: [] })).toEqual(defaultWorkLayout());
  });
  it("a remembered view or person is not a column customisation, but it is something to keep", () => {
    const d = defaultWorkLayout();
    expect(isDefaultWorkLayout(d)).toBe(true);
    expect(isEmptyWorkLayout(d)).toBe(true);
    const cal = rememberView(d, "calendar");
    expect(isDefaultWorkLayout(cal)).toBe(true);
    expect(isEmptyWorkLayout(cal)).toBe(false);
    const mine = rememberWho(d, "mine");
    expect(isDefaultWorkLayout(mine)).toBe(true);
    expect(isEmptyWorkLayout(mine)).toBe(false);
    // Back to the List with the default person: nothing left to keep.
    expect(isEmptyWorkLayout(rememberWho(rememberView(cal, "list"), undefined))).toBe(true);
  });
  it("rememberView / rememberWho: the same object back when nothing changes (no save)", () => {
    const d = defaultWorkLayout();
    expect(rememberView(d, "list")).toBe(d);
    expect(rememberWho(d, undefined)).toBe(d);
    expect(rememberWho(d, "")).toBe(d);
    const cal = rememberView(d, "calendar");
    expect(rememberView(cal, "calendar")).toBe(cal);
    expect(rememberView(cal, "list")).toEqual(d);
    const mine = rememberWho(cal, "mine");
    expect(mine).toEqual({ ...cal, who: "mine" });
    expect(rememberWho(mine, "mine")).toBe(mine);
    expect(rememberWho(mine, PAT).who).toBe(PAT);
  });
  it("a column change keeps the view and person: Reset layout does not forget the Calendar", () => {
    const cur = rememberWho(
      rememberView(hideBucket(defaultWorkLayout(), "later"), "calendar"),
      "mine",
    );
    const reset = keepRemembered(defaultWorkLayout(), cur);
    expect(reset).toEqual({ ...defaultWorkLayout(), view: "calendar", who: "mine" });
    expect(isDefaultWorkLayout(reset)).toBe(true);
    const kinds = keepRemembered(toggleKind(cur, "bid"), cur);
    expect(kinds.hiddenKinds).toEqual(["bid"]);
    expect(kinds.view).toBe("calendar");
    expect(kinds.who).toBe("mine");
  });
  it("saved and loaded with the columns: profile and browser copies alike", async () => {
    const l = rememberWho(rememberView(defaultWorkLayout(), "calendar"), PAT);
    const { written } = await save(l);
    expect(written).toMatchObject({ view: "calendar", who: PAT, hiddenKinds: [] });
    expect(await load(written)).toEqual({ layout: l });
    const store = new Map<string, string>();
    const s = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    writeStoredWorkLayout(s, ME, l);
    expect(readStoredWorkLayout(s, ME)).toEqual(l);
    writeStoredWorkLayout(s, ME, defaultWorkLayout());
    expect(readStoredWorkLayout(s, ME)).toBeNull();
  });
  it("the schema refuses a view it does not know and an over-long who", async () => {
    await expect(save({ order: [], hidden: [], view: "kanban" })).rejects.toThrow();
    await expect(save({ order: [], hidden: [], who: "x".repeat(65) })).rejects.toThrow();
  });
});

describe("landingSearch: the URL when it speaks, else what is remembered, else the defaults", () => {
  const saved: WorkLayout = { ...defaultWorkLayout(), view: "calendar", who: "mine" };
  const admin = { role: "admin" as const, access: [] };
  const user = { role: "user" as const, access: ["customers"] };
  it("nothing saved, nothing in the URL: the List and the caller's default person", () => {
    expect(landingSearch(null, {})).toEqual({ view: "list", who: null });
    expect(landingSearch(undefined, { view: null, who: null })).toEqual({
      view: "list",
      who: null,
    });
    expect(landingSearch(defaultWorkLayout(), {})).toEqual({ view: "list", who: null });
  });
  it("the sidebar's bare link opens where the user was", () => {
    expect(landingSearch(saved, {})).toEqual({ view: "calendar", who: "mine" });
    expect(landingSearch({ ...defaultWorkLayout(), who: PAT }, {})).toEqual({
      view: "list",
      who: PAT,
    });
  });
  it("the URL wins, key by key", () => {
    expect(landingSearch(saved, { view: "owner" })).toEqual({ view: "owner", who: "mine" });
    expect(landingSearch(saved, { who: PAT })).toEqual({ view: "calendar", who: PAT });
    expect(landingSearch(saved, { view: "owner", who: "all" })).toEqual({
      view: "owner",
      who: "all",
    });
    // Junk in the URL is as good as nothing.
    expect(landingSearch(saved, { view: "kanban", who: "" })).toEqual({
      view: "calendar",
      who: "mine",
    });
  });
  it("a remembered Owner view for a non-admin becomes the List (effectiveView); an admin keeps it", () => {
    const l = landingSearch({ ...defaultWorkLayout(), view: "owner" }, {});
    expect(effectiveView(l.view, user)).toBe("list");
    expect(effectiveView(l.view, admin)).toBe("owner");
  });
});

describe("shouldSeedWorkLayout: the list's copy of the layout and the cache", () => {
  const now = 1_000_000_000;
  it("an empty cache is seeded", () => {
    expect(shouldSeedWorkLayout(undefined, now)).toBe(true);
    expect(shouldSeedWorkLayout({ dataUpdatedAt: 0 }, now)).toBe(true);
    expect(shouldSeedWorkLayout({ data: undefined, dataUpdatedAt: now }, now)).toBe(true);
  });
  it("a cache written within the window (a local save) is left alone; an old one is refreshed", () => {
    const data = { layout: null };
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now }, now)).toBe(false);
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now - LAYOUT_SEED_STALE_MS + 1 }, now)).toBe(
      false,
    );
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now - LAYOUT_SEED_STALE_MS }, now)).toBe(
      true,
    );
    // Shorter than the list's 5-minute refresh, so every refresh may bring another device's change.
    expect(LAYOUT_SEED_STALE_MS).toBeLessThan(5 * 60_000);
  });
});

describe("the page and the route", () => {
  const page = readFileSync("src/components/my-work-page.tsx", "utf8");
  const route = readFileSync("src/routes/my-work.tsx", "utf8");
  it("the page resolves the view and the person from the URL, else the remembered layout", () => {
    expect(page).toContain(
      "const landing = landingSearch(layout, { view: props.view, who: props.who });",
    );
    expect(page).toContain("const view = effectiveView(landing.view, profile);");
    expect(page).toContain("const who = resolveWho(landing.who, profile);");
    expect(page).toContain('queryKey: ["my-work", who],');
    // The browser's copy is there from the first render (no flash of the List, one list fetch).
    expect(page).toContain(
      "() => (userId && readStoredWorkLayout(storage, userId)) || defaultWorkLayout(),",
    );
  });
  it("picking a view or a person saves it through the layout, then puts it in the URL", () => {
    expect(page).toContain("const next = rememberView(layout, v);");
    expect(page).toContain("const next = rememberWho(layout, whoParam(w, profile));");
    expect(page.match(/if \(next !== layout\) commitLayout\(next\);/g)).toHaveLength(2);
    expect(page).toContain('onClick={() => changeView("list")}');
    expect(page).toContain('onClick={() => changeView("calendar")}');
    expect(page).toContain('onClick={() => changeView("owner")}');
    expect(page).toContain("<Select value={who} onValueChange={changeWho}>");
    expect(page).not.toContain('props.onView("');
    // Column and kind changes keep them.
    expect(page).toContain(
      "const onLayout = (l: WorkLayout) => commitLayout(keepRemembered(l, layout));",
    );
    // No Reset button or chips for a remembered view: the bar still asks isDefaultWorkLayout.
    expect(page).toContain("const customized = !isDefaultWorkLayout(layout);");
    expect(page).toContain("layout: isEmptyWorkLayout(l) ? null : l,");
  });
  it("the profile's copy comes with the list; the separate read is never fetched on its own", () => {
    expect(page).toContain("const listLayout = q.data?.layout;");
    expect(page).toMatch(
      /queryKey: \["work-layout", userId\],\s*queryFn: \(\) => layoutFn\(\),\s*enabled: false,/,
    );
    expect(page).toContain(
      'if (shouldSeedWorkLayout(qc.getQueryState(["work-layout", userId]), Date.now()))',
    );
    expect(page).not.toContain("enabled: !!session && !!userId,");
  });
  it("the route hands the page the URL's values as they are, and keeps ?month across views", () => {
    expect(route).toContain("view={view ?? null}");
    expect(route).toContain("who={who ?? null}");
    expect(route).toContain("month={month ?? null}");
    expect(route).toContain('const month = parseMonthParam(s["month"]);');
    expect(route).toContain("...(m ? { month: m } : {}),");
    expect(route).toContain("searchOf(v, curWho, null, month)");
    expect(route).toContain("searchOf(curView, w, bucket, month)");
    expect(route).not.toContain("view={curView}");
    // The sidebar's link stays a bare /my-work: the remembered values apply through the page.
    expect(readFileSync("src/components/app-sidebar.tsx", "utf8")).toContain(
      '<Link to="/my-work">',
    );
  });
  it("the Calendar's month is the URL's (null = this month), never on the profile", () => {
    expect(page).toContain("const month = urlMonth ?? today.slice(0, 7);");
    expect(page).toContain("onMonth={(m) => props.onMonth(m === today.slice(0, 7) ? null : m)}");
    expect(page).not.toContain("const [month, setMonth] = useState");
    expect(readFileSync("src/lib/work-layout.ts", "utf8")).not.toMatch(/month\??: string/);
  });
});
