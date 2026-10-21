/**
 * Work Overview and the sign-in gate, owner Oct 20 (the third read-only audit's findings,
 * approved as fixes):
 *
 *  1. The AuthGate's decision and the Outlet's page came from different router commits:
 *     `resolvedLocation` moves in a layout effect AFTER the commit that renders the new matches,
 *     so leaving /login after a sign-in rendered the destination once BARE (no shell, no
 *     TooltipProvider) — a cached Work Overview threw ×5 into the root boundary. Three legs: the
 *     gate reads the committed matches' pathname (`committedPathname`); one TooltipProvider sits
 *     at the root over every page; a sign-out (and the Unauthorized event) clears the query cache.
 *  2. The hide-all guard counted columns the viewer never has: `hideBucket` takes the `present`
 *     buckets, and the empty line tells "every column hidden" from "every group empty".
 *  3. A phone tab pick outlived its group: `activeTab` falls back when the picked column folded
 *     away; tapping the preset's own tab no longer clears the preset.
 *  4. BUCKET_HELP.unassigned said "Claim one to take it" to people who cannot Claim.
 *  a. A dispatcher without the tick lost sight of the ticket they assigned: `assignedToastExtra`
 *     adds "It now shows on the Service board" and an Open action.
 *  b. "Kept on this device only" held only while the page stayed mounted: the `unsaved` flag is
 *     stored beside the browser's copy, read back on mount, and the copy retried once.
 *  c. Two competing post-sign-in navigations: the login page's own `/bids` ones are gone; the
 *     gate's `homeFor` redirect waits for the profile (a technician-only user lands on My tickets).
 *  d. Peeking from an Owner-view link then switching the person rewrote the remembered who:
 *     `shouldRememberWho`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { committedPathname } from "@/lib/committed-pathname";
import {
  BUCKET_HELP,
  BUCKET_LABELS,
  LIST_BUCKETS,
  activeTab,
  defaultBucket,
  listGroups,
  presetBucket,
  splitEmptyGroups,
  type WorkBucket,
  type WorkGroup,
  type WorkItem,
} from "@/lib/my-work";
import { ASSIGNED_TICKET_NOTE, assignedToastExtra } from "@/lib/my-work-actions";
import {
  applyWorkLayout,
  defaultWorkLayout,
  emptyListLine,
  hideBucket,
  normalizeWorkLayout,
  readStoredWork,
  readStoredWorkLayout,
  rememberView,
  shouldRememberWho,
  writeStoredWorkLayout,
} from "@/lib/work-layout";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/my-work-page.tsx");
const list = page.slice(page.indexOf("function ListView"), page.indexOf("function CalendarView"));
const gate = read("src/components/auth-gate.tsx");
const root = read("src/routes/__root.tsx");
const auth = read("src/lib/auth-context.tsx");
const login = read("src/routes/login.tsx");
const hook = read("src/components/my-work-actions.tsx");
const TODAY = "2026-10-20";

const task = (id: string, due: string | null): WorkItem => ({
  key: `task:${id}`,
  kind: "task",
  title: id,
  where: null,
  date: due,
  status: "Open",
  done: false,
  href: "/prospect",
  assigneeId: "me",
  assigneeName: "Me",
  followup: null,
});
const group = (bucket: WorkBucket, items: WorkItem[] = []): WorkGroup => ({
  bucket,
  label: BUCKET_LABELS[bucket],
  items,
});

class FakeStorage {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

// ---- 1. the gate's pathname, the root TooltipProvider, the cleared cache -------------------------

describe("1. committedPathname: the page the Outlet renders, from the same commit", () => {
  it("the last committed match's pathname; the location before the first commit", () => {
    const loc = { pathname: "/my-work" };
    expect(
      committedPathname({
        matches: [{ pathname: "/" }, { pathname: "/service" }, { pathname: "/service/today" }],
        location: loc,
      }),
    ).toBe("/service/today");
    // Mid-navigation: the location has moved, the matches have not — the gate stays with them.
    expect(committedPathname({ matches: [{ pathname: "/login" }], location: loc })).toBe("/login");
    expect(committedPathname({ matches: [], location: loc })).toBe("/my-work");
  });
  it("the gate selects it; resolvedLocation and location are no longer read for the decision", () => {
    expect(gate).toContain('import { committedPathname } from "@/lib/committed-pathname";');
    expect(gate).toContain("const pathname = useRouterState({ select: committedPathname });");
    expect(gate).not.toContain("s.resolvedLocation");
    expect(gate).not.toContain("s.location.pathname");
    // The decisions themselves are unchanged: bare login, spinner while signed out or blocked,
    // the shell otherwise; the signed-in visitor to /login goes home.
    expect(gate).toContain("if (isLogin) return <>{children}</>;");
    // Oct 20, audit 4 (b): the shell renders through a profile load; `loading` only holds the
    // /login redirect (work-overview-oct20-audit4.test.ts).
    expect(gate).toContain("if (!session) return <Waiting />;");
    expect(gate).toContain("if (blocked) return <Waiting />;");
    expect(gate).toContain("return <AuthedShell>{children}</AuthedShell>;");
    expect(gate).toMatch(
      /\} else if \(session && isLogin\) \{\s*if \(decision === "home"\) \{\s*navigate\(\{ to: home \}\);/,
    );
  });
  it("one TooltipProvider at the root wraps the gate and every page; the shell's nests inside", () => {
    expect(root).toContain('import { TooltipProvider } from "@/components/ui/tooltip";');
    expect(root).toMatch(
      /<TooltipProvider delayDuration=\{0\}>\s*<AuthGate>\s*<Outlet \/>\s*<\/AuthGate>\s*<\/TooltipProvider>/,
    );
    expect(read("src/components/ui/sidebar.tsx")).toContain("<TooltipProvider delayDuration={0}>");
    // BucketHelp's comment names the root's provider, not the shell's as its only one.
    const help = page.slice(
      page.indexOf("function BucketHelp") - 700,
      page.indexOf("function BucketHelp"),
    );
    expect(help).toContain("the root's TooltipProvider (routes/__root.tsx");
  });
  it("sign-out and the Unauthorized event clear the query cache", () => {
    expect(auth).toContain('import { useQueryClient } from "@tanstack/react-query";');
    expect(auth).toContain("const queryClient = useQueryClient();");
    expect(auth).toMatch(
      /await supabase\.auth\.signOut\(\);\s*profileRef\.current = null;\s*setProfile\(null\);[\s\S]{0,300}queryClient\.clear\(\);\s*\},/,
    );
    const unauthorized = auth.slice(
      auth.indexOf("const onUnauthorized = () => {"),
      auth.indexOf("window.addEventListener(UNAUTHORIZED_EVENT"),
    );
    expect(unauthorized).toContain("queryClient.clear();");
    // The effect that installs the handler lists the client it closes over.
    expect(auth).toContain("}, [queryClient]);");
    // The provider sits under the QueryClientProvider it reads.
    expect(root.indexOf("<QueryClientProvider client={queryClient}>")).toBeLessThan(
      root.indexOf("<AuthProvider>"),
    );
  });
});

// ---- 2. the hide-all guard ---------------------------------------------------------------------

describe("2. hideBucket counts only the columns the viewer has", () => {
  // A sales person's groups: no Needs authorization, no Authorized — to invoice (listGroups).
  const sales = listGroups([], TODAY, { unassigned: true }).map((g) => g.bucket);
  it("the viewer's last present column cannot be hidden, though other buckets exist in the order", () => {
    expect(sales).toEqual(["unassigned", "overdue", "week", "later", "waiting"]);
    let l = defaultWorkLayout();
    for (const b of ["unassigned", "overdue", "week", "later"] as WorkBucket[])
      l = hideBucket(l, b, sales);
    expect(l.hidden).toEqual(["unassigned", "overdue", "week", "later"]);
    // Without `present` (the old rule) authorize and invoice counted and Waiting went too.
    expect(hideBucket(l, "waiting").hidden).toContain("waiting");
    // With it, Waiting is the last column this viewer has: refused, the same object back.
    expect(hideBucket(l, "waiting", sales)).toBe(l);
    // The viewer still shows something.
    const groups = listGroups([], TODAY, { unassigned: true });
    expect(applyWorkLayout(groups, l).shown.map((g) => g.bucket)).toEqual(["waiting"]);
  });
  it("an authorizer and invoicer keeps the old count: the last of all nine", () => {
    const all = listGroups([], TODAY, { authorize: true, invoice: true, unassigned: true }).map(
      (g) => g.bucket,
    );
    expect(all).toEqual(LIST_BUCKETS);
    let l = defaultWorkLayout();
    for (const b of LIST_BUCKETS.slice(0, -1)) l = hideBucket(l, b, all);
    expect(l.hidden).toHaveLength(LIST_BUCKETS.length - 1);
    expect(hideBucket(l, LIST_BUCKETS[LIST_BUCKETS.length - 1]!, all)).toBe(l);
    // A hidden one is refused as before; null `present` is the old behaviour exactly.
    expect(hideBucket(l, "unassigned", all)).toBe(l);
    expect(hideBucket(defaultWorkLayout(), "week", null)).toEqual(
      hideBucket(defaultWorkLayout(), "week"),
    );
  });
  it("the page: the X passes the viewer's buckets; the empty line tells hidden from empty", () => {
    expect(list).toContain("const present = useMemo(() => groups.map((g) => g.bucket), [groups]);");
    expect(list).toContain("onLayout(hideBucket(layout, g.bucket, present))");
    expect(list).not.toContain("hideBucket(layout, g.bucket))");
    // Oct 21: the wording moved to emptyListLine (work-layout.ts), which also tells items sitting
    // in hidden columns from nothing to do (work-overview-oct21-audit7.test.ts).
    expect(list).toMatch(
      /const nothing = columns\.length === 0 && \(\s*<p className="text-sm text-muted-foreground">\{emptyListLine\(shown, hidden\)\}<\/p>\s*\);/,
    );
    expect(emptyListLine([], [])).toBe("Every column is hidden — bring one back from Hidden.");
    expect(emptyListLine([{}], [])).toBe("Nothing to do: every group is empty.");
  });
});

// ---- 3. the phone tab ---------------------------------------------------------------------------

describe("3. activeTab: a pick survives its group emptying; the preset's own tab keeps the preset", () => {
  const overdue = group("overdue", [task("late", "2026-10-01")]);
  const week = group("week", [task("soon", TODAY)]);
  it("the pick while its column is there, else the default", () => {
    expect(activeTab([overdue, week], "week", null)).toBe("week");
    // The picked group's last item got done: its column folded away — the default takes over.
    expect(activeTab([overdue], "week", null)).toBe("overdue");
    expect(activeTab([overdue], "week", null)).toBe(defaultBucket([overdue], null));
    expect(activeTab([overdue, week], null, null)).toBe("overdue");
    // No columns at all: the default's "week" (the tabs are not rendered then).
    expect(activeTab([], "later", null)).toBe("week");
  });
  it("a preset: the pick wins while present; otherwise the preset's bucket", () => {
    const weekKept = group("week");
    const { columns } = splitEmptyGroups([overdue, weekKept], presetBucket("today"));
    expect(columns.map((g) => g.bucket)).toEqual(["overdue", "week"]);
    expect(activeTab(columns, null, "today")).toBe("week");
    expect(activeTab(columns, "overdue", "today")).toBe("overdue");
    expect(activeTab(columns, "later", "overdue")).toBe("overdue");
  });
  it("the page: activeTab over the columns; pick compares with presetBucket", () => {
    expect(page).toMatch(/import \{[^}]*\bactiveTab\b[^}]*\} from "@\/lib\/my-work";/);
    expect(list).toContain("const bucket = activeTab(columns, picked, preset);");
    expect(list).not.toContain("picked ?? defaultBucket");
    expect(list).toContain("if (preset && b !== presetBucket(preset)) onClearPreset();");
    expect(list).not.toContain("b !== preset)");
    // The selected tab and the panel's label still read `bucket` / `group`.
    expect(list).toContain("const selected = g.bucket === bucket;");
    expect(list).toContain("aria-labelledby={`work-tab-${group.bucket}`}");
  });
});

// ---- 4. the Unassigned help ---------------------------------------------------------------------

describe("4. BUCKET_HELP.unassigned is role-neutral", () => {
  it("names the tick and Assign to; keeps Admin › Reminders", () => {
    expect(BUCKET_HELP.unassigned).toBe(
      "Tickets, tasks and opportunities with nobody on them yet. Claim one if you are ticked Technician, or put someone on it with Assign to; they turn red after the number of days set on Admin › Reminders.",
    );
    expect(BUCKET_HELP.unassigned).not.toContain("Claim one to take it");
    // Still one or two sentences, as the fold test requires of every help.
    expect(BUCKET_HELP.unassigned.split(/(?<=\.)\s+(?=[A-Z“])/).length).toBeLessThanOrEqual(2);
  });
  it("the server's comment names the right page", () => {
    const fn = read("src/lib/my-work.functions.ts");
    expect(fn).toContain('The "needs assignment" timer (Admin › Reminders;');
    expect(fn).not.toContain("Setup › Reminders");
  });
});

// ---- a. the assigned ticket's toast -------------------------------------------------------------

describe("a. assignedToastExtra: where the ticket went, for a viewer who no longer lists it", () => {
  const dispatcher = { role: "user", access: ["service"], technician: false, id: "d" };
  const manager = { role: "manager", access: [], technician: false, id: "m" };
  const plan = { kind: "ticket" as const, id: "t-1" };
  it("a non-seesEveryone viewer assigning a ticket: the note and an Open action to the ticket", () => {
    expect(assignedToastExtra(dispatcher, plan)).toEqual({
      description: ASSIGNED_TICKET_NOTE,
      action: { label: "Open", href: "/service?id=t-1" },
    });
    expect(ASSIGNED_TICKET_NOTE).toBe("It now shows on the Service board");
  });
  it("nothing for an admin or a manager (the ticket stays listed), nor for a task or an opportunity", () => {
    expect(assignedToastExtra(manager, plan)).toBeNull();
    expect(assignedToastExtra({ ...manager, role: "admin" }, plan)).toBeNull();
    expect(assignedToastExtra(dispatcher, { kind: "task", id: "x" })).toBeNull();
    expect(assignedToastExtra(dispatcher, { kind: "opportunity", id: "x" })).toBeNull();
    expect(assignedToastExtra(null, plan)).toEqual(assignedToastExtra(dispatcher, plan));
  });
  it("the hook: the success toast carries the description and the action as the Done tick's Undo does", () => {
    expect(hook).toContain('import { useNavigate } from "@tanstack/react-router";');
    expect(hook).toContain("const navigate = useNavigate();");
    expect(hook).toContain("const extra = assignedToastExtra(profile, v);");
    expect(hook).toMatch(
      /toast\.success\(\s*assignedToast\(v\.name, v\.day, kept\),\s*extra\s*\?\s*\{\s*description: extra\.description,\s*action: \{\s*label: extra\.action\.label,\s*onClick: \(\) => void navigate\(\{ href: extra\.action\.href \}\),\s*\},\s*\}\s*: undefined,\s*\);/,
    );
  });
});

// ---- b. the unsaved flag ------------------------------------------------------------------------

describe("b. the browser's copy carries an `unsaved` flag that outlives the page", () => {
  it("round-trips: the flag is read back; old shapes read as saved; the layout is unchanged", () => {
    const s = new FakeStorage();
    const l = hideBucket(defaultWorkLayout(), "later");
    writeStoredWorkLayout(s, "u1", l, true);
    expect(readStoredWork(s, "u1")).toEqual({ layout: l, unsaved: true });
    expect(readStoredWorkLayout(s, "u1")).toEqual(l);
    // A later success writes it plain and the flag is gone.
    writeStoredWorkLayout(s, "u1", l);
    expect(readStoredWork(s, "u1")).toEqual({ layout: l, unsaved: false });
    // The shape stored before the flag existed.
    s.setItem("jbk-portal:work-layout:u2", JSON.stringify(l));
    expect(readStoredWork(s, "u2")).toEqual({ layout: l, unsaved: false });
    expect(readStoredWork(s, "nobody")).toBeNull();
    expect(readStoredWork(null, "u1")).toBeNull();
    s.setItem("jbk-portal:work-layout:u3", "{not json");
    expect(readStoredWork(s, "u3")).toBeNull();
  });
  it("an unsaved Reset (the default) is kept, so it still wins on remount; a saved one clears", () => {
    const s = new FakeStorage();
    writeStoredWorkLayout(s, "u1", defaultWorkLayout(), true);
    expect(readStoredWork(s, "u1")).toEqual({ layout: defaultWorkLayout(), unsaved: true });
    writeStoredWorkLayout(s, "u1", defaultWorkLayout());
    expect(readStoredWork(s, "u1")).toBeNull();
  });
  it("the flag never reaches the layout itself (normalizeWorkLayout drops it)", () => {
    const l = rememberView(hideBucket(defaultWorkLayout(), "later"), "calendar");
    const n = normalizeWorkLayout({ ...l, unsaved: true });
    expect(n).toEqual(l);
    expect("unsaved" in n).toBe(false);
  });
  it("the page: localWins starts from the flag; one retry on mount; the flag follows the save", () => {
    expect(page).toMatch(/import \{[^}]*\breadStoredWork\b[^}]*\} from "@\/lib\/work-layout";/);
    expect(page).toMatch(
      /const \[localWins, setLocalWins\] = useState\(\s*\(\) => !!userId && !!readStoredWork\(storage, userId\)\?\.unsaved,\s*\);/,
    );
    // Oct 20, audit 4 (e): each handler writes the latest committed layout, and only for a save
    // of that layout (applySaveResult; work-overview-oct20-audit4.test.ts).
    expect(page).toMatch(
      /onSuccess: \(_r, l\) => \{\s*const r = applySaveResult\(latestLayoutRef\.current, l, true\);\s*if \(!r\) return;\s*setLocalWins\(false\);\s*if \(userId\) writeStoredWorkLayout\(storage, userId, r\.layout\);\s*\},/,
    );
    expect(page).toMatch(
      /onError: \(_e, l\) => \{\s*const r = applySaveResult\(latestLayoutRef\.current, l, false\);\s*if \(!r\) return;\s*setLocalWins\(true\);\s*if \(userId\) writeStoredWorkLayout\(storage, userId, r\.layout, true\);\s*toast\.error\(LAYOUT_SAVE_FAILED, \{ duration: 10_000 \}\);\s*\}/,
    );
    expect(page).toMatch(
      /const retriedUnsaved = useRef\(false\);\s*const \{ mutate: retrySave \} = saveLayout;\s*useEffect\(\(\) => \{\s*if \(!userId \|\| retriedUnsaved\.current\) return;\s*const stored = readStoredWork\(storage, userId\);\s*if \(!stored\?\.unsaved\) return;\s*retriedUnsaved\.current = true;\s*setLocalWins\(true\);\s*latestLayoutRef\.current = stored\.layout;\s*retrySave\(stored\.layout\);\s*\}, \[retrySave, storage, userId\]\);/,
    );
    // The retry sits before the seed effect reads localWins — and the seed still honours it.
    expect(page.indexOf("const { mutate: retrySave } = saveLayout;")).toBeLessThan(
      page.indexOf("shouldSeedWorkLayout(qc.getQueryState("),
    );
  });
});

// ---- c. one post-sign-in navigation -------------------------------------------------------------

describe("c. the login page no longer navigates; the gate's home redirect waits for the profile", () => {
  it("login.tsx has no navigation of its own; busy until the gate moves; errors still shown", () => {
    expect(login).not.toContain('to: "/bids"');
    expect(login).not.toContain("useNavigate");
    expect(login).not.toContain("navigate(");
    expect(login).toContain("const leaving = !!session;");
    expect(login).toContain("disabled={submitting || leaving}");
    expect(login).toContain('{submitting || leaving ? "Signing in…" : "Sign in"}');
    expect(login).toContain('? "Incorrect email or password."');
    expect(login).toContain(
      ': "Could not reach the sign-in service — check your connection and try again."',
    );
    expect(login).toMatch(/if \(signInError\) \{\s*setSubmitting\(false\);/);
  });
  it("the gate still sends a signed-in visitor of /login home (homeFor: My tickets for a technician-only user)", () => {
    expect(gate).toContain("const home = homeFor(profile);");
    // Oct 20, audit 4 (d): with the profile (landingDecision "home"); without it the gate asks
    // again first (work-overview-oct20-audit4.test.ts).
    expect(gate).toMatch(
      /\} else if \(session && isLogin\) \{\s*if \(decision === "home"\) \{\s*navigate\(\{ to: home \}\);/,
    );
    // The provider holds `loading` through a sign-in's profile load, so `home` is the person's
    // (audit 4 (b): only a real sign-in — shouldHoldForProfile — and bounded).
    expect(auth).toMatch(
      /if \(shouldHoldForProfile\(had, next, event\)\) \{\s*setLoading\(true\);/,
    );
    expect(gate).toMatch(/useEffect\(\(\) => \{\s*if \(loading\) return;/);
  });
});

// ---- d. peeking from the Owner view ------------------------------------------------------------

describe("d. shouldRememberWho: not while peeking from an Owner-view link", () => {
  it("an explicit ?view=list that differs from the remembered view: the pick is not remembered", () => {
    expect(shouldRememberWho({ viewExplicit: true, urlView: "list" }, "owner")).toBe(false);
    expect(shouldRememberWho({ viewExplicit: true, urlView: "list" }, "calendar")).toBe(false);
  });
  it("otherwise the pick is remembered as before", () => {
    // The remembered view is the List (or none): the explicit List agrees.
    expect(shouldRememberWho({ viewExplicit: true, urlView: "list" }, undefined)).toBe(true);
    expect(shouldRememberWho({ viewExplicit: true, urlView: "list" }, "list")).toBe(true);
    // No explicit view: the sidebar's link, the sign-in landing.
    expect(shouldRememberWho({ viewExplicit: false, urlView: null }, "owner")).toBe(true);
    // An explicit Calendar or Owner view is the person's own choice.
    expect(shouldRememberWho({ viewExplicit: true, urlView: "calendar" }, "owner")).toBe(true);
    expect(shouldRememberWho({ viewExplicit: true, urlView: "owner" }, undefined)).toBe(true);
  });
  it("the page: changeWho asks it; the view buttons remember as before", () => {
    expect(page).toMatch(/import \{[^}]*\bshouldRememberWho\b[^}]*\} from "@\/lib\/work-layout";/);
    expect(page).toMatch(
      /const changeWho = \(w: string\) => \{\s*if \(\s*shouldRememberWho\(\s*\{ viewExplicit: props\.view !== null, urlView: props\.view \},\s*layout\.view,?\s*\)\s*\) \{\s*const next = rememberWho\(layout, whoParam\(w, profile\)\);\s*if \(next !== layout\) commitLayout\(next\);\s*\}\s*props\.onWho\(w\);\s*\};/,
    );
    expect(page).toMatch(
      /const changeView = \(v: MyWorkView\) => \{\s*const next = rememberView\(layout, v\);\s*if \(next !== layout\) commitLayout\(next\);\s*props\.onView\(v\);\s*\};/,
    );
  });
});
