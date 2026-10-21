/**
 * Work Overview, owner Oct 21 (the eighth audit's client-side findings, approved as fixes):
 *
 *  4. Phone: a Show tick on an Owner-page landing moved the selected tab. ?bucket=today lands on
 *     This week (Today folds into it); ticking a kind off under Show clears the preset
 *     (kindToggleClearsPreset → onBucket(null)), ListView saw the preset change and nextPicked
 *     gave null — no pick, no preset — so activeTab fell to the first non-empty column (Overdue).
 *     The person ticked a kind and the page changed tabs. nextPicked now carries the preset's own
 *     column into the pick when the preset clears with no tap of their own, so the tab stays
 *     put; a tap still stands (Oct 20), and a column that folded away still falls back as before.
 *  5. The gone-person fallback could fire before the profile arrived and pin an admin to Mine.
 *     The gate renders the page with the session alone (auth-context retries a null first read
 *     after 1.2 s); the work query ran on the session, the complete roster came back, and with
 *     the profile still null effectiveWho's default is "mine" — the effect called onWho("mine"),
 *     which the route writes as an EXPLICIT ?who=mine (Oct 21), and when the profile arrived
 *     Everyone was lost for the visit. The effect waits for the profile: a remembered or linked
 *     person is simply shown until it lands, then the fallback runs once as before.
 *     resolveWho and the query key are untouched: with the profile null the key is "mine" and
 *     then "all" once it lands — two round trips, accepted (finding 4/f).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  activeTab,
  defaultBucket,
  effectiveWho,
  nextPicked,
  presetBucket,
  splitEmptyGroups,
  type BucketPreset,
  type WorkBucket,
} from "@/lib/my-work";
import { kindToggleClearsPreset } from "@/lib/work-layout";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/my-work-page.tsx");
const list = page.slice(page.indexOf("function ListView"), page.indexOf("function CalendarView"));
const lib = read("src/lib/my-work.ts");

/** A group as the phone-tab helpers see it: the bucket and how many items it has. */
const group = (bucket: WorkBucket, n: number) => ({ bucket, items: new Array<unknown>(n).fill(0) });

// ---- 4. the phone tab under a Show tick --------------------------------------------------------

describe("4. nextPicked: the preset clearing without a tap keeps the preset's own column", () => {
  // /my-work?view=list&who=X&bucket=today on a phone: Overdue has items, This week has items.
  const columns = [group("overdue", 2), group("week", 3), group("later", 1)];

  it("the Owner-page landing shows This week; the Show tick keeps it there", () => {
    const preset: BucketPreset = "today";
    // Landing: no pick yet, the preset picks the tab — Today folds into This week.
    expect(nextPicked(null, preset, null)).toBeNull();
    expect(activeTab(columns, null, preset)).toBe("week");
    // The tick under Show clears the preset (the page: onBucket(null)) — not a tap on a tab.
    expect(kindToggleClearsPreset(preset)).toBe(true);
    const picked = nextPicked(preset, null, null);
    // The tab that was showing is carried into the pick …
    expect(picked).toBe("week");
    expect(picked).toBe(presetBucket(preset));
    // … so the selected tab does not move. Before: null → the first non-empty column, Overdue.
    expect(activeTab(columns, picked, null)).toBe("week");
    expect(activeTab(columns, null, null)).toBe("overdue");
  });

  it("?bucket=overdue the same: the Overdue tab stays on a tick", () => {
    expect(nextPicked("overdue", null, null)).toBe("overdue");
    expect(activeTab([group("week", 3), group("overdue", 1)], "overdue", null)).toBe("overdue");
  });

  it("the person's own tap still stands when the preset clears (Oct 20)", () => {
    // They tapped Later: `pick` set it and cleared the preset through the URL.
    expect(nextPicked("today", null, "later")).toBe("later");
    expect(nextPicked("overdue", null, "week")).toBe("week");
  });

  it("a new preset still wins over any pick; no preset either side is no change", () => {
    expect(nextPicked(null, "today", "later")).toBeNull();
    expect(nextPicked("today", "overdue", "week")).toBeNull();
    expect(nextPicked("today", "today", "later")).toBe("later");
    expect(nextPicked(null, null, "later")).toBe("later");
    expect(nextPicked(null, null, null)).toBeNull();
  });

  it("the carried column that folded away falls back as before", () => {
    // Every This week item was of the kind just ticked off: once the preset no longer keeps
    // the column (`keep`), the fold drops it, and the default takes over.
    const after = splitEmptyGroups([group("overdue", 2), group("week", 0)], null);
    expect(after.columns.map((c) => c.bucket)).toEqual(["overdue"]);
    const picked = nextPicked("today", null, null);
    expect(activeTab(after.columns, picked, null)).toBe("overdue");
    expect(activeTab(after.columns, picked, null)).toBe(defaultBucket(after.columns, null));
  });

  it("the source: nextPicked carries presetBucket(prevPreset); the page's call is as it was", () => {
    const fn = lib.slice(
      lib.indexOf("export function nextPicked"),
      lib.indexOf("// ---- calendar"),
    );
    expect(fn).toContain("if (preset !== null) return preset !== prevPreset ? null : picked;");
    expect(fn).toContain("return picked ?? (prevPreset ? presetBucket(prevPreset) : null);");
    expect(list).toMatch(
      /if \(prevPreset !== preset\) \{\s*setPrevPreset\(preset\);\s*setPicked\(nextPicked\(prevPreset, preset, picked\)\);\s*\}/,
    );
    expect(list).toContain("const bucket = activeTab(columns, picked, preset);");
    // The path that clears the preset on a tick (Oct 20) is untouched.
    expect(page).toContain("if (kindToggleClearsPreset(props.bucket)) props.onBucket(null);");
  });
});

// ---- 5. the gone-person fallback before the profile -------------------------------------------

describe("5. the gone-person fallback waits for the profile", () => {
  const ME = "11111111-1111-4111-8111-111111111111";
  const BOB = "22222222-2222-4222-8222-222222222222";
  const GONE = "33333333-3333-4333-8333-333333333333";
  const admin = { id: ME, role: "admin" };
  const people = [{ id: ME }, { id: BOB }];
  type Profile = typeof admin | null;

  /**
   * The effect, as the page runs it, over the real helpers: what it would call onWho with, or
   * null for nothing. `old` is the condition before this fix (shownWho !== who alone).
   */
  const fallback = (
    who: string,
    profile: Profile,
    rosterComplete: boolean,
    opts: { old?: boolean; roster?: { id: string }[] } = {},
  ) => {
    const shownWho = effectiveWho(who, opts.roster ?? people, profile, rosterComplete);
    if (!opts.old && !profile) return null;
    if (shownWho === who) return null;
    return shownWho;
  };

  it("a remembered person who is gone, the roster complete, the profile not yet here", () => {
    // Before: defaultWho(null) is "mine" — onWho("mine"), an explicit ?who=mine for the visit.
    expect(effectiveWho(GONE, people, null, true)).toBe("mine");
    expect(fallback(GONE, null, true, { old: true })).toBe("mine");
    // Now: nothing until the profile lands …
    expect(fallback(GONE, null, true)).toBeNull();
    // … then the fallback runs once, to the admin's real default.
    expect(fallback(GONE, admin, true)).toBe("all");
  });

  it("the admin's own id linked (?who=<me>) with the profile still null", () => {
    // ownToMine cannot read "mine" without the profile's id; before, with a complete roster
    // that did not list the caller, the effect fell to "mine" early and wrote it explicitly.
    const roster = [{ id: BOB }];
    expect(fallback(ME, null, true, { old: true, roster })).toBe("mine");
    expect(fallback(ME, null, true, { roster })).toBeNull();
    // With the profile here the id reads as Mine, and that is what the URL gets — once.
    expect(fallback(ME, admin, true, { roster })).toBe("mine");
  });

  it("nothing changes for a who that stands, or an incomplete roster", () => {
    expect(fallback(BOB, admin, true)).toBeNull();
    expect(fallback(GONE, admin, false)).toBeNull();
    expect(fallback("all", null, true)).toBeNull();
    expect(fallback("mine", null, true)).toBeNull();
  });

  it("the page: the effect returns before the profile is known, and depends on it", () => {
    expect(page).toContain(
      "const shownWho = effectiveWho(who, people, profile, !!q.data?.rosterComplete);",
    );
    expect(page).toMatch(
      /useEffect\(\(\) => \{[^}]*?if \(!profile\) return;\s*if \(shownWho === who\) return;\s*const forgotten = forgetWho\(layout, who\);\s*if \(forgotten !== layout\) commitLayout\(forgotten\);\s*props\.onWho\(shownWho\);/,
    );
    expect(page).toMatch(/props\.onWho\(shownWho\);[\s\S]*?\}, \[profile, shownWho, who\]\);/);
    // resolveWho and the query key are as they were (finding 4/f: two round trips, accepted).
    expect(page).toContain("const who = resolveWho(landing.who, profile);");
    expect(page).toContain('queryKey: ["my-work", who],');
  });
});
