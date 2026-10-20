/**
 * Work Overview, the task dialog and the sign-in gate, owner Oct 20 (the fourth read-only
 * audit's findings, approved as fixes):
 *
 *  1. A lost update: editing a task in the dialog reopened one somebody else had just ticked
 *     Done — the form always sent the status it loaded and saveTask wrote it over the live row.
 *     Two halves: the dialog sends `status` only when the Done box was touched (taskSavePayload,
 *     `statusTouched`), and carries the row's updated_at as `expect_content_updated_at`, which saveTask
 *     checks before and in the write (TASK_CHANGED); the dialog reloads the task on it.
 *  3. The Owner view's numbers opened a List that could not show what they counted: the List
 *     applied the unticked kinds (kindsForLanding shows every kind for that landing, and says
 *     so), and the totals row lacked the "incl. N opportunities" sub-link each person's row has.
 *  4. A failed refetch hid the whole list: the error block shows only without data; with data
 *     the list stays and a small "Could not refresh" line sits above it.
 *  7. A phone tab tap was lost after an Owner-view link: the pick reset whenever the preset
 *     changed, the person's own tap clearing it included (nextPicked).
 *  8. Column help text drifted from bucketOf: Overdue omitted tasks and follow-ups; This week
 *     said "later this week" though today's items sit there, and omitted opportunities.
 *  a. No way out of a hung profile read after sign-in: the login page shows the gate's stalled
 *     notice after SIGN_IN_STALL_MS; the provider's SIGNED_IN hold is bounded (PROFILE_HOLD_MS).
 *  b. A null profile plus a tab wake remounted the whole page: the hold is for a real sign-in
 *     only (shouldHoldForProfile), and the gate keeps the shell while a session loads.
 *  c. A SIGNED_OUT raised outside signOut (another tab, a failed refresh) left the cache.
 *  d. homeFor(null) sent a profile-less technician to Work Overview: landingDecision asks for the
 *     profile again first, then lands with a toast; the Work Overview route asks once more.
 *  e. Two overlapping layout saves could resurrect the older one: applySaveResult, and the
 *     "profile's copy wins" effect keeps the unsaved flag.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/tasks-notify.server", () => ({
  sendTaskNotice: vi.fn(async () => ({ users: 0, emails: 0, errors: [] as string[] })),
}));

import {
  landingDecision,
  PROFILE_HOLD_MS,
  PROFILE_LANDING_TRIES,
  PROFILE_MISSING_TOAST,
  PROFILE_RETRY_MS,
  shouldHoldForProfile,
  SIGN_IN_STALL_MS,
  signInStalled,
} from "@/lib/auth-flow";
import {
  BUCKET_HELP,
  BUCKET_LABELS,
  bucketOf,
  nextPicked,
  type BucketIn,
  type WorkBucket,
} from "@/lib/my-work";
import { oppsHref } from "@/lib/owner-view";
import { TASK_CHANGED, taskInputSchema, taskSavePayload, type TaskInput } from "@/lib/tasks";
import { saveTask, setTaskStatus, type SaveTaskResult } from "@/lib/tasks.functions";
import {
  applySaveResult,
  defaultWorkLayout,
  hideBucket,
  kindsForLanding,
  toggleKind,
} from "@/lib/work-layout";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/my-work-page.tsx");
const list = page.slice(page.indexOf("function ListView"), page.indexOf("function CalendarView"));
const dialog = read("src/components/tasks/task-dialog.tsx");
const fns = read("src/lib/tasks.functions.ts");
const ownerView = read("src/components/owner-view.tsx");
const gate = read("src/components/auth-gate.tsx");
const auth = read("src/lib/auth-context.tsx");
const login = read("src/routes/login.tsx");
const route = read("src/routes/my-work.tsx");
const stalled = read("src/components/stalled-sign-in.tsx");

const ANN = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const TASK = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const T1 = "2026-10-20T13:00:00.000Z";
const T0 = "2026-10-19T09:00:00.000Z";

type Fn = (a: { data: Row; context: unknown }) => Promise<unknown>;
const call = <T>(fn: unknown, data: Row, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;

// ---- 1. the lost update ------------------------------------------------------------------------

// Oct 20, the fifth audit: the stamp is the row's content_updated_at (20261020121000), with
// updated_at standing in until that migration is applied — these rows carry none, so the
// fallback is what is pinned here; src/lib/task-content-stamp.test.ts covers the content stamp.
describe("1. taskSavePayload: status only when touched; the row's stamp rides along", () => {
  const input: TaskInput = taskInputSchema.parse({
    id: TASK,
    title: "Walk the roof",
    date: "2026-10-21",
    assignee: BOB,
    attendees: [BOB],
    status: "open",
  });
  const row = { updated_at: T1 };
  it("editing, Done untouched: no status (the server keeps the live one), expect_content_updated_at set", () => {
    const p = taskSavePayload(input, row, false);
    expect("status" in p).toBe(false);
    expect(p.expect_content_updated_at).toBe(T1);
    expect(p.title).toBe("Walk the roof");
  });
  it("editing, Done touched: the status goes (explicit intent), expect_content_updated_at set", () => {
    expect(taskSavePayload({ ...input, status: "done" }, row, true)).toMatchObject({
      status: "done",
      expect_content_updated_at: T1,
    });
    expect(taskSavePayload(input, row, true).status).toBe("open");
  });
  it("a new task is sent as it is (no row to expect)", () => {
    const fresh = { ...input, id: undefined };
    expect(taskSavePayload(fresh, null, false)).toBe(fresh);
    expect(taskSavePayload(fresh, undefined, true)).toBe(fresh);
    expect(taskInputSchema.parse({ title: "x" }).expect_content_updated_at).toBeUndefined();
  });
  it("the wording", () => {
    expect(TASK_CHANGED).toBe("This task changed since you opened it — reopen it");
  });
});

describe("1. saveTask through the fake: A ticks Done, B saves a stale form", () => {
  const profiles: Row[] = [
    { id: ANN, role: "admin", access: [], technician: false, full_name: "Ann", email: "a@x" },
    { id: BOB, role: "admin", access: [], technician: false, full_name: "Bob", email: "b@x" },
  ];
  const task = (): Row => ({
    id: TASK,
    title: "Walk the roof",
    details: null,
    status: "open",
    assignee: BOB,
    assignee_name: "Bob",
    attendees: [BOB],
    external_emails: [],
    created_by: ANN,
    created_by_name: "Ann",
    account_id: null,
    account_name: null,
    site_id: null,
    site_name: null,
    building_id: null,
    due_date: "2026-10-21",
    due_at: "2026-10-21T12:00:00.000Z",
    all_day: true,
    done_at: null,
    done_by: null,
    done_by_name: null,
    notify_error: null,
    updated_at: T1,
  });
  const env = () =>
    fakeSupabase(
      { profiles: profiles.map((p) => ({ ...p })), tasks: [task()] },
      {
        rpcs: {
          assignable_users: () =>
            profiles.map((p) => ({ id: p["id"], full_name: p["full_name"], email: p["email"] })),
        },
      },
    );
  /** B's form as loaded before A's tick: open, with a retitled task. */
  const bobsForm = (extra: Row = {}): Row => ({
    id: TASK,
    title: "Walk the roof with the facilities manager",
    date: "2026-10-21",
    all_day: true,
    assignee: BOB,
    attendees: [BOB],
    external_emails: [],
    ...extra,
  });

  it("B did not touch Done (no status): A's Done stands, B's title lands", async () => {
    const e = env();
    await call(setTaskStatus, { id: TASK, status: "done" }, e.db, ANN);
    expect(e.tables["tasks"]![0]!["status"]).toBe("done");
    const r = await call<SaveTaskResult>(
      saveTask,
      bobsForm({ expect_content_updated_at: T1 }),
      e.db,
      BOB,
    );
    expect(r.task.status).toBe("done");
    expect(r.task.title).toBe("Walk the roof with the facilities manager");
    expect(r.task.done_by).toBe(ANN);
    // The write was checked against the row B loaded.
    const w = e.writes.filter((x) => x.table === "tasks" && x.op === "update");
    expect(w.at(-1)?.filters).toEqual([`eq id=${TASK}`, `eq updated_at=${T1}`]);
  });
  it("B ticked Done off (status open): the explicit intent reopens it", async () => {
    const e = env();
    await call(setTaskStatus, { id: TASK, status: "done" }, e.db, ANN);
    const r = await call<SaveTaskResult>(
      saveTask,
      bobsForm({ status: "open", expect_content_updated_at: T1 }),
      e.db,
      BOB,
    );
    expect(r.task.status).toBe("open");
    expect(r.task.done_at).toBeNull();
    expect(r.task.done_by).toBeNull();
  });
  it("a stale expect_content_updated_at is refused with TASK_CHANGED and nothing is written", async () => {
    const e = env();
    await expect(
      call(saveTask, bobsForm({ expect_content_updated_at: T0 }), e.db, BOB),
    ).rejects.toThrow(TASK_CHANGED);
    expect(e.writes).toEqual([]);
    expect(e.tables["tasks"]![0]!["title"]).toBe("Walk the roof");
  });
  it("no expectation (a caller that never loaded the row): nothing is checked, as before", async () => {
    const e = env();
    const r = await call<SaveTaskResult>(saveTask, bobsForm(), e.db, BOB);
    expect(r.task.title).toBe("Walk the roof with the facilities manager");
    const w = e.writes.filter((x) => x.table === "tasks" && x.op === "update");
    expect(w.at(-1)?.filters).toEqual([`eq id=${TASK}`]);
  });
  it("a new task is created as before (no row, no check)", async () => {
    const e = env();
    const r = await call<SaveTaskResult>(
      saveTask,
      { title: "New one", date: "2026-10-22", all_day: true, assignee: BOB, attendees: [BOB] },
      e.db,
      BOB,
    );
    expect(r.task.status).toBe("open");
    expect(e.writes.some((x) => x.table === "tasks" && x.op === "insert")).toBe(true);
  });
  it("the server: the compare, the .eq on the stamp, maybeSingle → TASK_CHANGED", () => {
    expect(fns).toContain("const expected = data.expect_content_updated_at;");
    expect(fns).toContain(
      "if (expected && contentStamp(before) !== expected) throw new Error(TASK_CHANGED);",
    );
    expect(fns).toContain("if (expected) upd = upd.eq(contentStampColumn(before), expected);");
    expect(fns).toContain("const { data: saved, error } = await upd.select().maybeSingle();");
    expect(fns).toContain("if (!saved) throw new Error(TASK_CHANGED);");
    // The insert path is unchanged.
    expect(fns).toMatch(/\.insert\(\{\s*\.\.\.fields,\s*title: data\.title,\s*source: "manual",/);
  });
  it("the dialog: statusTouched, the payload, the reload on TASK_CHANGED", () => {
    expect(dialog).toContain("const [statusTouched, setStatusTouched] = useState(false);");
    expect(dialog).toContain("const [live, setLive] = useState<TaskRow | null>(null);");
    expect(dialog).toContain("const task = live ?? props.task;");
    // Reset with the form on open.
    expect(dialog).toMatch(
      /setEmailText\(""\);\s*setStatusTouched\(false\);\s*setLive\(null\);\s*setChanged\(null\);\s*\/\/ eslint-disable-next-line/,
    );
    expect(dialog).toMatch(
      /onCheckedChange=\{\(v\) => \{\s*setStatusTouched\(true\);\s*set\(\{ status: v === true \? "done" : "open" \}\);\s*\}\}/,
    );
    expect(dialog).toContain("save.mutate(taskSavePayload(parsed.data, task, statusTouched));");
    expect(dialog).not.toContain("save.mutate(parsed.data);");
    expect(dialog).toMatch(
      /onError: \(e\) => \{\s*toast\.error\(errText\(e\)\);\s*if \(errText\(e\) === TASK_CHANGED && task\) reload\.mutate\(task\.id\);\s*\},/,
    );
    // The fifth audit: the reload keeps the typed form (no setF) and notes what changed.
    expect(dialog).toMatch(
      /const reload = useMutation\(\{\s*mutationFn: \(id: string\) => getTaskFn\(\{ data: \{ id \} \}\),\s*onSuccess: \(row\) => \{\s*const opened = live \?\? props\.task;\s*setChanged\(opened \? taskChangeNotice\(taskToInput\(opened\), taskToInput\(row\)\) : \[\]\);\s*setLive\(row\);\s*invalidate\(\);\s*\},/,
    );
    // The dialog stays open on the refusal (onSuccess alone closes it).
    expect(dialog).toContain(
      "const busy = save.isPending || remove.isPending || reload.isPending;",
    );
  });
});

// ---- 3. the Owner view's numbers land where they can be shown ----------------------------------

describe("3. kindsForLanding: an Owner-view link shows every kind, and says so", () => {
  const l = toggleKind(defaultWorkLayout(), "bid");
  it("a preset with unticked kinds: no hidden kinds for this landing, the note names Show", () => {
    const r = kindsForLanding(l, "today");
    expect(r.layout.hiddenKinds).toEqual([]);
    expect(r.layout.order).toEqual(l.order);
    expect(r.note).toBe("Showing every kind for this link (Show is 5 of 6).");
    expect(kindsForLanding(toggleKind(l, "task"), "overdue").note).toBe(
      "Showing every kind for this link (Show is 4 of 6).",
    );
    // The person's own setting is untouched.
    expect(l.hiddenKinds).toEqual(["bid"]);
  });
  it("no preset, or nothing unticked: the same layout, no note", () => {
    expect(kindsForLanding(l, null)).toEqual({ layout: l, note: null });
    expect(kindsForLanding(l, undefined).layout).toBe(l);
    expect(kindsForLanding(defaultWorkLayout(), "today").note).toBeNull();
    const d = hideBucket(defaultWorkLayout(), "later");
    expect(kindsForLanding(d, "overdue").layout).toBe(d);
  });
  it("the page: the List's items go through it; the line shows on the List with data", () => {
    expect(page).toMatch(/import \{[^}]*\bkindsForLanding\b[^}]*\} from "@\/lib\/work-layout";/);
    expect(page).toContain(
      "const landingKinds = useMemo(() => kindsForLanding(layout, props.bucket), [layout, props.bucket]);",
    );
    expect(page).toMatch(
      /const visibleItems = useMemo\(\s*\(\) => applyKinds\(items, landingKinds\.layout\),\s*\[items, landingKinds\.layout\],\s*\);/,
    );
    expect(page).toMatch(
      /\{view === "list" && q\.data && landingKinds\.note && \(\s*<p className="text-xs text-muted-foreground" data-row="landing-kinds">\s*\{landingKinds\.note\}\s*<\/p>\s*\)\}/,
    );
    // The Show menu still reads the person's own layout.
    expect(page).toContain("Show: {kindsSummary(layout)}");
  });
  it("the totals row: incl. N opportunities, to everyone's overdue opportunities", () => {
    expect(oppsHref("all", true)).toEqual({
      to: "/opportunities",
      search: { status: "allopen", overdue: 1 },
    });
    const footer = ownerView.slice(
      ownerView.indexOf("<TableFooter>"),
      ownerView.indexOf("</TableFooter>"),
    );
    expect(footer).toContain("{totals.overdueOpps > 0 && (");
    expect(footer).toContain('{...oppsHref("all", true)}');
    expect(footer).toMatch(
      /incl\. \{totals\.overdueOpps\} opportunit\s*\{totals\.overdueOpps === 1 \? "y" : "ies"\}/,
    );
    // Beside the Overdue total, not elsewhere.
    expect(footer.indexOf('myWorkHref("all", "overdue")')).toBeLessThan(
      footer.indexOf('oppsHref("all", true)'),
    );
    expect(footer.indexOf('oppsHref("all", true)')).toBeLessThan(
      footer.indexOf("{totals.doneThisWeek}"),
    );
  });
});

// ---- 4. a failed refetch keeps the list ---------------------------------------------------------

describe("4. the error block only without data; with data a Could not refresh line", () => {
  it("the page", () => {
    expect(page).toContain(") : errMsg && !q.data ? (");
    expect(page).not.toContain(") : errMsg ? (");
    expect(page).toContain("Could not load your work: {errMsg}");
    expect(page).toMatch(
      /\{errMsg && \(\s*<p className="text-xs text-destructive" data-row="refresh-failed">\s*Could not refresh: \{errMsg\} ·\{" "\}\s*<button\s*type="button"\s*className="underline underline-offset-4"\s*onClick=\{\(\) => void q\.refetch\(\)\}\s*>\s*Try again\s*<\/button>\s*<\/p>\s*\)\}\s*\{view === "calendar" \? \(/,
    );
    // The views still render under it.
    expect(page).toMatch(/<CalendarView\s+items=\{visibleItems\}/);
    expect(page).toMatch(/<ListView\s+items=\{visibleItems\}/);
  });
});

// ---- 7. the phone tab -----------------------------------------------------------------------------

describe("7. nextPicked: a new preset drops the pick; the preset going away keeps it", () => {
  it("preset → tap another tab → the preset clears → the tap stands", () => {
    // An Owner-view link lands with ?bucket=today: no pick yet.
    expect(nextPicked(null, "today", null)).toBeNull();
    // The person taps Later: pick clears the preset through the URL (preset → null).
    const picked: WorkBucket = "later";
    expect(nextPicked("today", null, picked)).toBe("later");
    // Another Owner-view link while here: the new preset wins over the earlier pick.
    expect(nextPicked(null, "overdue", picked)).toBeNull();
    expect(nextPicked("today", "overdue", picked)).toBeNull();
    // The same preset is no change at all.
    expect(nextPicked("today", "today", picked)).toBe("later");
    expect(nextPicked(null, null, picked)).toBe("later");
  });
  it("the page resets the pick through it", () => {
    expect(page).toMatch(/import \{[^}]*\bnextPicked\b[^}]*\} from "@\/lib\/my-work";/);
    expect(list).toMatch(
      /if \(prevPreset !== preset\) \{\s*setPrevPreset\(preset\);\s*setPicked\(nextPicked\(prevPreset, preset, picked\)\);\s*\}/,
    );
    expect(list).not.toContain("setPicked(null);");
    expect(list).toContain("if (preset && b !== presetBucket(preset)) onClearPreset();");
  });
});

// ---- 8. the help ----------------------------------------------------------------------------------

describe("8. BUCKET_HELP matches bucketOf", () => {
  const TODAY = "2026-10-20";
  // bucketOf reads no kind: every kind of item lands by its day alone.
  const item = (date: string): BucketIn => ({
    date,
    done: false,
    needsAuth: false,
    unassigned: false,
    toInvoice: false,
    followup: null,
  });
  it("an item of any kind lands in Overdue by its day; today's sit in Today, folded into This week", () => {
    expect(bucketOf(item("2026-10-19"), TODAY)).toBe("overdue");
    expect(bucketOf(item(TODAY), TODAY)).toBe("today");
    expect(bucketOf(item("2026-10-23"), TODAY)).toBe("week");
    expect(BUCKET_LABELS.today).toBe("Today");
  });
  it("the wording, one or two sentences each", () => {
    expect(BUCKET_HELP.overdue).toBe(
      "Tickets, tasks, follow-ups, opportunities and draft bids past their day. The assignee is reminded on the Reminders schedule.",
    );
    expect(BUCKET_HELP.week).toBe(
      "Due today or later this week: tickets, tasks, follow-ups, opportunities and draft bids.",
    );
    for (const b of ["overdue", "week"] as const) {
      expect(BUCKET_HELP[b]).toMatch(/^[A-Z].*\.$/);
      expect(BUCKET_HELP[b].split(/(?<=\.)\s+(?=[A-Z“])/).length).toBeLessThanOrEqual(2);
    }
    expect(BUCKET_HELP.week).not.toContain("later this week.");
    expect(BUCKET_HELP.overdue).not.toContain("Scheduled tickets whose day has passed");
  });
});

// ---- a. the way out of a hung profile read ------------------------------------------------------

describe("a. the login page's stalled notice; the provider's bounded hold", () => {
  it("signInStalled: after SIGN_IN_STALL_MS of leaving; the bounds", () => {
    expect(SIGN_IN_STALL_MS).toBe(8_000);
    expect(PROFILE_HOLD_MS).toBe(12_000);
    expect(signInStalled(true, 8_000)).toBe(true);
    expect(signInStalled(true, 7_999)).toBe(false);
    expect(signInStalled(false, 60_000)).toBe(false);
  });
  it("one notice component, used by the gate's Waiting and the login page", () => {
    expect(stalled).toContain("function startOver()");
    expect(stalled).not.toContain("export function startOver()");
    expect(stalled).toContain("export function StalledNotice()");
    expect(stalled).toContain("This is taking longer than it should.");
    expect(stalled).toContain("Reload");
    expect(stalled).toContain("Sign in again");
    expect(stalled).toContain("onClick={startOver}");
    expect(gate).toContain('import { StalledNotice } from "@/components/stalled-sign-in";');
    expect(gate).toContain("const t = setTimeout(() => setStalled(true), SIGN_IN_STALL_MS);");
    expect(gate).toContain("{stalled && <StalledNotice />}");
    expect(gate).not.toContain("function startOver()");
    expect(login).toContain('import { StalledNotice } from "@/components/stalled-sign-in";');
    expect(login).toMatch(
      /useEffect\(\(\) => \{\s*if \(!leaving\) \{\s*setStalled\(false\);\s*return;\s*\}\s*const t = setTimeout\(\(\) => setStalled\(true\), SIGN_IN_STALL_MS\);\s*return \(\) => clearTimeout\(t\);\s*\}, \[leaving\]\);/,
    );
    expect(login).toMatch(
      /\{leaving && stalled && \(\s*<div[^>]*data-row="stalled">\s*<StalledNotice \/>/,
    );
    // The button and the error texts are as they were.
    expect(login).toContain("const leaving = !!session;");
    expect(login).toContain("disabled={submitting || leaving}");
  });
  it("the provider: the SIGNED_IN hold is cleared after PROFILE_HOLD_MS if the profile never settles", () => {
    expect(auth).toContain(
      'import { PROFILE_HOLD_MS, shouldHoldForProfile } from "@/lib/auth-flow";',
    );
    expect(auth).toMatch(
      /if \(shouldHoldForProfile\(had, next, event\)\) \{\s*setLoading\(true\);[\s\S]{0,200}guard = setTimeout\(\(\) => \{\s*if \(active\) setLoading\(false\);\s*\}, PROFILE_HOLD_MS\);\s*\}\s*setSession\(next\);\s*await loadProfile\(next\);\s*if \(guard\) clearTimeout\(guard\);\s*setLoading\(false\);/,
    );
    // The mount guard stays.
    expect(auth).toMatch(
      /const guard = setTimeout\(\(\) => \{\s*if \(active\) setLoading\(false\);\s*\}, 12_000\);/,
    );
  });
});

// ---- b. the hold is for a real sign-in only -----------------------------------------------------

describe("b. shouldHoldForProfile; the gate keeps the shell while a session loads", () => {
  const s = { access_token: "t" };
  it("fresh sign-in → true; tab wake with a session → false; TOKEN_REFRESHED → false", () => {
    expect(shouldHoldForProfile(null, s, "SIGNED_IN")).toBe(true);
    expect(shouldHoldForProfile(s, s, "SIGNED_IN")).toBe(false);
    expect(shouldHoldForProfile(s, s, "TOKEN_REFRESHED")).toBe(false);
    expect(shouldHoldForProfile(null, s, "TOKEN_REFRESHED")).toBe(false);
    expect(shouldHoldForProfile(null, s, "INITIAL_SESSION")).toBe(false);
    expect(shouldHoldForProfile(s, null, "SIGNED_OUT")).toBe(false);
    expect(shouldHoldForProfile(null, null, "SIGNED_IN")).toBe(false);
  });
  it("the provider tracks the session it last saw and holds through the rule, not the profile", () => {
    expect(auth).toContain("const sessionRef = useRef<Session | null>(null);");
    expect(auth).toMatch(/const had = sessionRef\.current;\s*sessionRef\.current = next;/);
    expect(auth).toMatch(/sessionRef\.current = data\.session;\s*setSession\(data\.session\);/);
    expect(auth).not.toContain('event === "SIGNED_IN" && next && !profileRef.current');
  });
  it("the gate: Waiting only without a session; the shell renders while the profile loads", () => {
    expect(gate).toContain("if (isLogin) return <>{children}</>;");
    expect(gate).toContain("if (!session) return <Waiting />;");
    expect(gate).not.toContain("if (loading || !session) return <Waiting />;");
    expect(gate).toContain("if (blocked) return <Waiting />;");
    expect(gate).toContain("return <AuthedShell>{children}</AuthedShell>;");
  });
});

// ---- c. a SIGNED_OUT from outside clears the cache ----------------------------------------------

describe("c. an externally raised SIGNED_OUT clears the query cache", () => {
  it("in the auth listener, beside the two existing calls", () => {
    const listener = auth.slice(
      auth.indexOf("supabase.auth.onAuthStateChange("),
      auth.indexOf("const onUnauthorized"),
    );
    expect(listener).toContain(
      'if (event === "SIGNED_OUT" || (!next && had)) queryClient.clear();',
    );
    const unauthorized = auth.slice(
      auth.indexOf("const onUnauthorized = () => {"),
      auth.indexOf("window.addEventListener(UNAUTHORIZED_EVENT"),
    );
    expect(unauthorized).toContain("queryClient.clear();");
    expect(unauthorized).toContain("sessionRef.current = null;");
    expect(auth).toMatch(
      /await supabase\.auth\.signOut\(\);\s*profileRef\.current = null;\s*setProfile\(null\);[\s\S]{0,300}queryClient\.clear\(\);\s*\},/,
    );
    expect(auth.split("queryClient.clear();").length - 1).toBe(3);
  });
});

// ---- d. no homeFor(null) landing before the profile was asked for again --------------------------

describe("d. landingDecision: retry for the profile, then home with a toast", () => {
  const s = { access_token: "t" };
  const p = { id: ANN, role: "user" };
  it("the decisions", () => {
    expect(PROFILE_LANDING_TRIES).toBe(3);
    expect(PROFILE_RETRY_MS).toBe(1_200);
    expect(landingDecision(null, null, 0)).toBe("stay");
    expect(landingDecision(null, p, 0)).toBe("stay");
    expect(landingDecision(s, p, 0)).toBe("home");
    expect(landingDecision(s, p, 99)).toBe("home");
    expect(landingDecision(s, null, 0)).toBe("retry");
    expect(landingDecision(s, null, 2)).toBe("retry");
    expect(landingDecision(s, null, 3)).toBe("home-without-profile");
    expect(landingDecision(s, null, 4)).toBe("home-without-profile");
    expect(PROFILE_MISSING_TOAST).toBe(
      "Could not load your profile — some pages may be missing until you reload",
    );
  });
  it("the gate: tries, the retry effect through refreshProfile, the give-up toast to homeFor(null)", () => {
    expect(gate).toContain(
      "const { session, profile, profileFailed, loading, refreshProfile } = useAuth();",
    );
    expect(gate).toContain("const [tries, setTries] = useState(0);");
    expect(gate).toMatch(
      /useEffect\(\(\) => \{\s*if \(!session\) setTries\(0\);\s*\}, \[session\]\);/,
    );
    expect(gate).toContain(
      "const decision = !loading && session && isLogin ? landingDecision(session, profile, tries) : null;",
    );
    expect(gate).toMatch(
      /\} else if \(session && isLogin\) \{\s*if \(decision === "home"\) \{\s*navigate\(\{ to: home \}\);\s*\} else if \(decision === "home-without-profile"\) \{\s*toast\.warning\(PROFILE_MISSING_TOAST\);\s*navigate\(\{ to: homeFor\(null\) \}\);\s*\}/,
    );
    expect(gate).toMatch(
      /useEffect\(\(\) => \{\s*if \(decision !== "retry"\) return undefined;\s*const t = setTimeout\(\(\) => \{\s*void refreshRef\.current\(\)\.finally\(\(\) => setTries\(\(n\) => n \+ 1\)\);\s*\}, PROFILE_RETRY_MS\);\s*return \(\) => clearTimeout\(t\);\s*\}, \[decision, tries\]\);/,
    );
    // The signed-out and blocked legs are as they were.
    expect(gate).toMatch(/if \(!session && !isLogin\) \{\s*navigate\(\{ to: "\/login" \}\);/);
    expect(gate).toMatch(/\} else if \(session && blocked\) \{\s*navigate\(\{ to: home \}\);\s*\}/);
  });
  it("the Work Overview route asks for a missing profile once", () => {
    expect(route).toContain('import { useEffect, useRef } from "react";');
    expect(route).toContain("const { profile, session, refreshProfile } = useAuth();");
    expect(route).toMatch(
      /const refreshed = useRef\(false\);\s*useEffect\(\(\) => \{\s*if \(!session \|\| profile \|\| refreshed\.current\) return;\s*refreshed\.current = true;\s*void refreshProfile\(\);\s*\}, \[profile, refreshProfile, session\]\);/,
    );
    // Before the early return, as hooks must be.
    expect(route.indexOf("const refreshed = useRef(false);")).toBeLessThan(
      route.indexOf("if (isFieldOnly(profile)) return <Navigate"),
    );
  });
});

// ---- e. overlapping layout saves ---------------------------------------------------------------

describe("e. applySaveResult: only the latest layout's save writes, and it writes the latest", () => {
  const older = hideBucket(defaultWorkLayout(), "later");
  const newer = hideBucket(older, "waiting");
  it("a late failure of an older save is ignored; the newer one's result writes the newer", () => {
    expect(applySaveResult(newer, older, false)).toBeNull();
    expect(applySaveResult(newer, older, true)).toBeNull();
    expect(applySaveResult(newer, newer, true)).toEqual({ layout: newer, unsaved: false });
    expect(applySaveResult(newer, newer, false)).toEqual({ layout: newer, unsaved: true });
  });
  it("before any commit (the stored copy's retry on mount) the settled layout is the latest", () => {
    expect(applySaveResult(null, older, true)).toEqual({ layout: older, unsaved: false });
    expect(applySaveResult(null, older, false)).toEqual({ layout: older, unsaved: true });
  });
  it("the page: latestLayoutRef follows commitLayout and the retry; the handlers go through it; the profile's copy keeps the flag", () => {
    expect(page).toMatch(/import \{[^}]*\bapplySaveResult\b[^}]*\} from "@\/lib\/work-layout";/);
    expect(page).toContain("const latestLayoutRef = useRef<WorkLayout | null>(null);");
    expect(page).toMatch(
      /const commitLayout = \(l: WorkLayout\) => \{\s*setLayout\(l\);\s*latestLayoutRef\.current = l;\s*if \(userId\) writeStoredWorkLayout\(storage, userId, l\);\s*saveLayout\.mutate\(l\);\s*\};/,
    );
    expect(page).toMatch(
      /latestLayoutRef\.current = stored\.layout;\s*retrySave\(stored\.layout\);/,
    );
    expect(page).toMatch(
      /onSuccess: \(_r, l\) => \{\s*const r = applySaveResult\(latestLayoutRef\.current, l, true\);\s*if \(!r\) return;\s*setLocalWins\(false\);\s*if \(userId\) writeStoredWorkLayout\(storage, userId, r\.layout\);\s*\},/,
    );
    expect(page).toMatch(
      /onError: \(_e, l\) => \{\s*const r = applySaveResult\(latestLayoutRef\.current, l, false\);\s*if \(!r\) return;\s*setLocalWins\(true\);\s*if \(userId\) writeStoredWorkLayout\(storage, userId, r\.layout, true\);\s*toast\.error\(LAYOUT_SAVE_FAILED, \{ duration: 10_000 \}\);\s*\},/,
    );
    expect(page).toMatch(
      /const localWinsRef = useRef\(localWins\);\s*useEffect\(\(\) => \{\s*localWinsRef\.current = localWins;\s*\}, \[localWins\]\);/,
    );
    expect(page).toMatch(
      /const l = savedLayout\.data\.layout \?\? defaultWorkLayout\(\);\s*setLayout\(l\);\s*writeStoredWorkLayout\(storage, userId, l, localWinsRef\.current\);\s*\}, \[savedLayout\.data, storage, userId\]\);/,
    );
  });
});
