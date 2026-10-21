/**
 * Work Overview, owner Oct 21 (the seventh audit's findings, approved as fixes):
 *
 *  2. An explicit Everyone was dropped from the URL on the next in-page navigation: the Owner
 *     view's totals row linked ?view=list&who=all&bucket=today, the admin tapped another bucket
 *     (or ticked a kind, changed month, clicked Calendar) and the URL fell back to ?view=list —
 *     silent on the person, so the remembered one (profile / localStorage) took over. The same
 *     bug was fixed for the view on Oct 20 (nextWorkSearch's viewExplicit); `who` gets the same
 *     rule (whoExplicit): a URL that named a person keeps naming them, the default included, and
 *     a pick in the Show menu always names its person (so Everyone picked while peeking lands as
 *     ?who=all and the remembered person does not come back). The bare URL is as it was.
 *  3. A remembered person who no longer exists could not be cleared while peeking: effectiveWho
 *     fell back to Everyone, but changeWho skipped the layout (shouldRememberWho false) and wrote
 *     a URL without ?who, which resolved the same remembered id again — an empty list, a blank
 *     picker, "Someone else: …" for good. The fallback now forgets that person on the layout
 *     whatever the peeking state (forgetWho) and names Everyone in the URL (2).
 *  6. `window.localStorage` was read bare: a browser that blocks site storage throws a
 *     SecurityError on the property read itself, and the whole page hit the error boundary. The
 *     page reads it through safeStorage(), which gives null when blocked; the profile's copy of
 *     the layout still applies.
 *  D. The List said "Nothing to do: every group is empty." under a "Hidden: + Overdue (2)" row:
 *     the fold leaves no column when the only items sit in a column the person hid with its X.
 *     emptyListLine says where the items are; the wording is as before when nothing is hidden.
 *     And the X on the preset's own column, kept in view while hidden (`keep`), did nothing
 *     (hideBucket returns the same layout): a muted "(hidden)" note stands in for it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  effectiveWho,
  nextWorkSearch,
  parseBucketPreset,
  parseViewParam,
  resolveWho,
  splitEmptyGroups,
  whoParam,
  type WorkBucket,
  type WorkViewUrl,
} from "@/lib/my-work";
import { myWorkHref } from "@/lib/owner-view";
import {
  applyWorkLayout,
  defaultWorkLayout,
  emptyListLine,
  forgetWho,
  hideBucket,
  landingSearch,
  rememberView,
  rememberWho,
  safeStorage,
  shouldRememberWho,
  type WorkLayout,
} from "@/lib/work-layout";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/my-work-page.tsx");
const route = read("src/routes/my-work.tsx");
const lib = read("src/lib/my-work.ts");

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";
const admin = { id: ME, role: "admin", access: [], technician: false };
const manager = { id: ME, role: "manager", access: [], technician: false };
const user = { id: ME, role: "user", access: [], technician: false };

/** What the route's validateSearch keeps of a search (parseViewParam / parseBucketPreset). */
const validate = (s: { view?: string; who?: string; bucket?: string; month?: string }) => ({
  view: parseViewParam(s.view),
  who: s.who,
  bucket: parseBucketPreset(s.bucket),
  month: s.month,
});
/** The route's pageView (Oct 21, later): "owner" is redirected, never a view of the page. */
const pageView = (v: WorkViewUrl | undefined) => (v === "owner" ? null : (v ?? null));

/** The route: curView / curWho from the URL, and whether the URL named each. */
const routeSearch = (
  url: { view?: string; who?: string; bucket?: string; month?: string },
  // A key present with `undefined` is a change TO nothing (a kind tick clears the preset).
  change: {
    view?: "list" | "calendar";
    who?: string;
    bucket?: string | undefined;
    month?: string | undefined;
  },
  pick = false,
) =>
  nextWorkSearch(
    {
      view: change.view ?? pageView(validate(url).view) ?? "list",
      who: change.who ?? resolveWho(url.who, admin),
      bucket: "bucket" in change ? parseBucketPreset(change.bucket) : validate(url).bucket,
      month: "month" in change ? change.month : url.month,
    },
    admin,
    url.view !== undefined,
    pick || url.who !== undefined,
  );

// ---- 2. an explicit Everyone stays explicit ---------------------------------------------------

describe("2. nextWorkSearch keeps a who the URL named, the caller's default included", () => {
  // Oct 21 (later): the Owner view moved to /owner; the remembered view that differs from the
  // explicit List is the Calendar now (it was "owner").
  const savedBob = { ...defaultWorkLayout(), view: "calendar" as const, who: BOB };
  it("the totals row's link, then a bucket tab: ?who=all stays, and the remembered Bob does not return", () => {
    const link = myWorkHref("all", "today", ME);
    const url = validate(link.search);
    expect(url).toMatchObject({ view: "list", who: "all", bucket: "today" });
    const next = routeSearch(link.search, { bucket: "overdue" });
    expect(next).toEqual({ view: "list", who: "all", bucket: "overdue" });
    const landing = landingSearch(savedBob, { view: next.view ?? null, who: next.who ?? null });
    expect(landing).toEqual({ view: "list", who: "all" });
    expect(landing.view).toBe("list"); // Oct 21 (later): no effectiveView; the view moved to /owner
    // The bug: whoParam drops the default, and without whoExplicit the URL fell silent on the
    // person — landingSearch read the remembered Bob.
    const old = nextWorkSearch({ view: "list", who: "all", bucket: "overdue" }, admin, true);
    expect(old.who).toBeUndefined();
    expect(landingSearch(savedBob, { view: "list", who: old.who ?? null }).who).toBe(BOB);
  });
  it("a kind tick (bucket cleared), a month change and a view change keep it too", () => {
    const link = myWorkHref("all", "today", ME).search;
    expect(routeSearch(link, { bucket: undefined })).toEqual({ view: "list", who: "all" });
    expect(routeSearch(link, { month: "2026-11" })).toEqual({
      view: "list",
      who: "all",
      bucket: "today",
      month: "2026-11",
    });
    expect(routeSearch(link, { view: "calendar", bucket: undefined })).toEqual({
      view: "calendar",
      who: "all",
    });
    // Mine and a person were never dropped; they still are not.
    expect(routeSearch({ view: "list", who: "mine" }, { bucket: "today" })).toEqual({
      view: "list",
      who: "mine",
      bucket: "today",
    });
    expect(routeSearch({ who: BOB }, { month: "2026-11" })).toEqual({ who: BOB, month: "2026-11" });
  });
  it("a pick in the Show menu names its person whatever the URL had: Everyone while peeking lands as ?who=all", () => {
    // Peeking: an Owner-view link to Bob's List while the layout remembers the Owner view.
    const link = myWorkHref(BOB, "overdue", ME).search;
    expect(shouldRememberWho({ viewExplicit: true, urlView: "list" }, savedBob.view)).toBe(false);
    const next = routeSearch(link, { who: "all" }, true);
    expect(next).toEqual({ view: "list", who: "all", bucket: "overdue" });
    expect(landingSearch(savedBob, { view: next.view ?? null, who: next.who ?? null }).who).toBe(
      "all",
    );
    // A hand-typed ?view=list without a person, still peeking: the pick is explicit all the same.
    expect(routeSearch({ view: "list" }, { who: "all" }, true)).toEqual({
      view: "list",
      who: "all",
    });
    // Not peeking (the bare sidebar URL): the pick is remembered AND named — the layout forgets
    // Bob through rememberWho, and the URL says Everyone.
    expect(rememberWho(savedBob, whoParam("all", admin)).who).toBeUndefined();
    expect(routeSearch({}, { who: "all" }, true)).toEqual({ who: "all" });
    expect(nextWorkSearch({ view: "list", who: "mine" }, user, false, true)).toEqual({
      who: "mine",
    });
  });
  it("the bare URL is as it was: the page's own navigations drop the default, the remembered person applies", () => {
    expect(nextWorkSearch({ view: "list", who: "all" }, admin, false, false)).toEqual({});
    expect(nextWorkSearch({ view: "list", who: "all" }, manager, false)).toEqual({});
    expect(nextWorkSearch({ view: "list", who: BOB }, admin, false, false)).toEqual({ who: BOB });
    expect(nextWorkSearch({ view: "calendar", who: "all" }, admin, false, false)).toEqual({
      view: "calendar",
    });
    expect(routeSearch({}, { bucket: "today" })).toEqual({ bucket: "today" });
    expect(landingSearch(savedBob, { view: null, who: null })).toEqual({
      view: "calendar",
      who: BOB,
    });
    // whoParam itself is unchanged: the default is still nothing.
    expect(whoParam("all", admin)).toBeUndefined();
    expect(whoParam("mine", user)).toBeUndefined();
  });
  it("the route hands nextWorkSearch whether the URL named a view and a who; onWho always names it", () => {
    expect(route).toContain("const viewExplicit = view !== undefined;");
    expect(route).toContain("const whoExplicit = who !== undefined;");
    expect(route).toContain(
      "nextWorkSearch({ view: v, who: w, bucket: b, month: m }, profile, viewExplicit, whoNamed);",
    );
    expect(route).toContain("whoNamed = whoExplicit,");
    expect(route).toContain("searchOf(curView, w, bucket, month, true)");
    expect(route).toContain("searchOf(v, curWho, null, month)");
    expect(route).toContain("searchOf(curView, curWho, bucket, m)");
    expect(route).toContain("searchOf(curView, curWho, b, month)");
    expect(route).not.toContain("profile, view !== undefined);");
    expect(lib).toContain("whoExplicit = false,");
    expect(lib).toContain(
      "...(wp ? { who: wp } : whoExplicit && next.who ? { who: next.who } : {}),",
    );
  });
});

// ---- 3. a remembered person who is gone ---------------------------------------------------------

describe("3. forgetWho: the gone person is dropped from the layout whatever the peeking state", () => {
  const people = [{ id: ME }, { id: BOB }];
  it("forgets the remembered who when it is that person; anyone else stays", () => {
    // Oct 21 (later): "calendar" where this read "owner" — the Owner view moved to /owner.
    const gone: WorkLayout = { ...defaultWorkLayout(), view: "calendar", who: GONE };
    const forgotten = forgetWho(gone, GONE);
    expect(forgotten.who).toBeUndefined();
    expect(forgotten.view).toBe("calendar"); // the view stays remembered
    expect(forgotten.order).toBe(gone.order);
    // A link to a gone person while Bob is remembered: Bob stays.
    const bob = { ...defaultWorkLayout(), who: BOB };
    expect(forgetWho(bob, GONE)).toBe(bob);
    // Nothing remembered: the same layout back.
    const none = defaultWorkLayout();
    expect(forgetWho(none, GONE)).toBe(none);
    expect(forgetWho(rememberView(none, "calendar"), GONE).view).toBe("calendar");
  });
  it("the whole flow while peeking: landing → effectiveWho → forgetWho + ?who=all → Everyone, and it sticks", () => {
    // The layout remembers the Owner view and a person who has since been deleted.
    // Oct 21 (later): the Owner view moved to /owner; the remembered view is the Calendar here.
    const saved: WorkLayout = { ...defaultWorkLayout(), view: "calendar", who: GONE };
    // The sidebar's bare URL lands on the Calendar; the Owner page's totals row links the List,
    // explicit.
    const bare = landingSearch(saved, { view: null, who: null });
    expect(bare).toEqual({ view: "calendar", who: GONE });
    // Or an Owner-view link peeks at the List with no person of its own (?view=list only, say
    // after a bookmark): the remembered GONE is resolved.
    const landing = landingSearch(saved, { view: "list", who: null });
    const who = resolveWho(landing.who, admin);
    expect(who).toBe(GONE);
    expect(shouldRememberWho({ viewExplicit: true, urlView: "list" }, saved.view)).toBe(false);
    // The complete roster does not have them: Everyone.
    const shown = effectiveWho(who, people, admin, true);
    expect(shown).toBe("all");
    // The page: forget them on the layout (not changeWho, which skips it while peeking) …
    const forgotten = forgetWho(saved, who);
    expect(forgotten.who).toBeUndefined();
    expect(forgotten.view).toBe("calendar");
    // … and onWho names Everyone in the URL, so the next render resolves "all" even before the
    // layout save lands.
    const next = nextWorkSearch({ view: "list", who: shown }, admin, true, true);
    expect(next).toEqual({ view: "list", who: "all" });
    expect(
      resolveWho(landingSearch(saved, { view: "list", who: next.who ?? null }).who, admin),
    ).toBe("all");
    // And the bare URL afterwards: the Calendar, nobody remembered — the default (Everyone).
    expect(landingSearch(forgotten, { view: null, who: null })).toEqual({
      view: "calendar",
      who: null,
    });
    // The bug: changeWho's URL had no who, so the same remembered id came back and the effect's
    // deps did not change.
    const old = nextWorkSearch({ view: "list", who: shown }, admin, true);
    expect(old.who).toBeUndefined();
    expect(landingSearch(saved, { view: "list", who: old.who ?? null }).who).toBe(GONE);
  });
  it("an incomplete roster still proves nothing (Oct 20): nobody is forgotten on it", () => {
    expect(effectiveWho(GONE, [{ id: ME }], admin, false)).toBe(GONE);
    expect(effectiveWho(BOB, people, admin, true)).toBe(BOB);
  });
  it("the page: the fallback effect forgets through forgetWho and names the fallback through onWho", () => {
    expect(page).toMatch(/import \{[^}]*\bforgetWho\b[^}]*\} from "@\/lib\/work-layout";/);
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*if \(shownWho === who\) return;[\s\S]*?const forgotten = forgetWho\(layout, who\);\s*if \(forgotten !== layout\) commitLayout\(forgotten\);\s*props\.onWho\(shownWho\);/,
    );
    expect(page).not.toContain("if (shownWho !== who) changeWho(shownWho);");
    // changeWho itself is as it was (the Show menu's pick; not remembered while peeking).
    expect(page).toContain("<Select value={who} onValueChange={changeWho}>");
  });
});

// ---- 6. blocked site storage -------------------------------------------------------------------

describe("6. safeStorage: null when the browser refuses localStorage, instead of a thrown page", () => {
  it("a throwing getter yields null", () => {
    const blocked = {
      get localStorage(): Storage {
        throw new Error("SecurityError: The operation is insecure.");
      },
    };
    expect(safeStorage(blocked)).toBeNull();
  });
  it("no window (the server) yields null; a window's storage is handed back as it is", () => {
    expect(safeStorage(undefined)).toBeNull();
    const store = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    } as unknown as Storage;
    expect(safeStorage({ localStorage: store })).toBe(store);
    // A window whose storage is null (some embedded views) is null too, not a crash.
    expect(safeStorage({ localStorage: null as unknown as Storage })).toBeNull();
  });
  it("the page reads storage through it, never window.localStorage bare", () => {
    expect(page).toMatch(/import \{[^}]*\bsafeStorage\b[^}]*\} from "@\/lib\/work-layout";/);
    expect(page).toContain("const storage = safeStorage();");
    expect(page).not.toContain("window.localStorage");
  });
});

// ---- D. the List with items in hidden columns only ----------------------------------------------

describe("D. emptyListLine: items sitting in hidden columns are not 'every group is empty'", () => {
  const list = page.slice(page.indexOf("function ListView"), page.indexOf("function CalendarView"));
  const group = (bucket: WorkBucket, n: number) => ({ bucket, items: Array<unknown>(n).fill(0) });
  it("the wording: nothing hidden as before; items in hidden groups say where they are", () => {
    expect(emptyListLine([], [])).toBe("Every column is hidden — bring one back from Hidden.");
    expect(emptyListLine([{}], [])).toBe("Nothing to do: every group is empty.");
    expect(emptyListLine([{}], [group("later", 0)])).toBe("Nothing to do: every group is empty.");
    expect(emptyListLine([{}], [group("overdue", 2)])).toBe(
      "Nothing to do in the groups you show — 2 items sit in hidden groups (bring one back from Hidden).",
    );
    expect(emptyListLine([{}], [group("overdue", 1), group("week", 0)])).toBe(
      "Nothing to do in the groups you show — 1 item sits in hidden groups (bring one back from Hidden).",
    );
    expect(emptyListLine([{}, {}], [group("overdue", 2), group("later", 3)])).toContain(
      "5 items sit in hidden groups",
    );
    // Every column hidden wins, whatever the hidden ones hold: the Hidden chips are the way back.
    expect(emptyListLine([], [group("overdue", 2)])).toBe(
      "Every column is hidden — bring one back from Hidden.",
    );
  });
  it("the flow: only Overdue has items, the person hid Overdue — the fold leaves no column", () => {
    const groups = [group("unassigned", 0), group("overdue", 2), group("week", 0)];
    const layout = hideBucket(defaultWorkLayout(), "overdue");
    const { shown, hidden } = applyWorkLayout(groups, layout);
    const { columns } = splitEmptyGroups(shown);
    expect(columns).toEqual([]);
    expect(shown.length).toBeGreaterThan(0);
    expect(hidden.map((g) => g.bucket)).toEqual(["overdue"]);
    // The bug: this read "Nothing to do: every group is empty." under a "Hidden: + Overdue (2)".
    expect(emptyListLine(shown, hidden)).toBe(
      "Nothing to do in the groups you show — 2 items sit in hidden groups (bring one back from Hidden).",
    );
  });
  it("the page: the line comes from emptyListLine; the preset's kept column shows a note, not a dead X", () => {
    expect(list).toMatch(
      /const nothing = columns\.length === 0 && \(\s*<p className="text-sm text-muted-foreground">\{emptyListLine\(shown, hidden\)\}<\/p>\s*\);/,
    );
    expect(list).not.toContain('"Nothing to do: every group is empty."');
    // The X on a column the person hid but the ?bucket= preset keeps (applyWorkLayout's `keep`)
    // did nothing — hideBucket gives the same layout back for a hidden bucket — so it is not
    // drawn; a muted "(hidden)" with its title stands in.
    const kept = hideBucket(defaultWorkLayout(), "overdue");
    expect(hideBucket(kept, "overdue")).toBe(kept);
    expect(applyWorkLayout([group("overdue", 2)], kept, "overdue").shown).toHaveLength(1);
    expect(list).toMatch(
      /\{layout\.hidden\.includes\(g\.bucket\) \? \(\s*<span[^>]*title="You hid this column; it shows for this link only\."\s*>\s*\(hidden\)\s*<\/span>\s*\) : \(\s*<button\s+type="button"\s+aria-label=\{`Hide \$\{g\.label\}`\}/,
    );
    expect(list).toContain("onLayout(hideBucket(layout, g.bucket, present))");
  });
});
