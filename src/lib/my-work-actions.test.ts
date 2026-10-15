/**
 * Work Overview's row actions (owner, Oct 15): a task row opens the task in place (its old link
 * led to the Prospecting map — a bare map for a task without a building), with "Open on map" for
 * a task that has one and a Done tick for whoever may change it; an assigned ticket or task is
 * dragged onto another calendar day to reschedule it; "Assign to…" on an Unassigned row; New
 * ticket / New opportunity in the toolbar, carrying the Calendar's selected day.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { dispatchesTickets, seesEveryone } from "./access";
import type { WorkItem } from "./my-work";
import {
  NEW_OPPORTUNITY_HREF,
  UNASSIGNED_TASK_HINT,
  assignKind,
  assignPlan,
  canEditWorkTask,
  canMoveWork,
  dropPlan,
  monthDay,
  newTicketHref,
  taskMapHref,
  taskOpensInPlace,
  workId,
} from "./my-work-actions";

const read = (p: string) => readFileSync(p, "utf8");

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

// The viewers the rules tell apart.
const admin = { id: ME, role: "admin", access: [], technician: false };
const manager = { id: ME, role: "manager", access: [], technician: false };
/** The office: a plain user who is not technician-only, with Service. */
const office = { id: ME, role: "user", access: ["service", "customers"], technician: false };
/** A plain user without Service (Customers only): no dispatching. */
const customersOnly = { id: ME, role: "user", access: ["customers"], technician: false };
/** A technician-only user. */
const tech = { id: ME, role: "user", access: ["service"], technician: true };

const item = (over: Partial<WorkItem>): WorkItem => ({
  key: "ticket:t1",
  kind: "ticket",
  title: "#101 Leak",
  where: null,
  date: "2026-10-20",
  status: "Scheduled",
  done: false,
  href: "/service?id=t1",
  assigneeId: BOB,
  assigneeName: "Bob",
  followup: null,
  ...over,
});
const task = (over: Partial<WorkItem> = {}) =>
  item({
    key: "task:k1",
    kind: "task",
    title: "Call the owner",
    href: "/prospect",
    assigneeId: ME,
    ...over,
  });

describe("the rules' premises (access.ts)", () => {
  it("who dispatches and who sees everyone", () => {
    expect(dispatchesTickets(admin)).toBe(true);
    expect(dispatchesTickets(manager)).toBe(true);
    expect(dispatchesTickets(office)).toBe(true);
    expect(dispatchesTickets(customersOnly)).toBe(false);
    expect(dispatchesTickets(tech)).toBe(false);
    expect(seesEveryone(office)).toBe(false);
    expect(seesEveryone(manager)).toBe(true);
  });
});

describe("a task row opens in place (bug 2, then owner: every task)", () => {
  it("every task, with or without a building; nothing else", () => {
    expect(taskOpensInPlace(task(), office)).toBe(true);
    expect(taskOpensInPlace(task({ href: "/prospect?building=b1" }), office)).toBe(true);
    expect(taskOpensInPlace(item({ kind: "ticket" }), admin)).toBe(false);
    expect(taskOpensInPlace(item({ kind: "inspection" }), admin)).toBe(false);
    expect(taskOpensInPlace(item({ kind: "followup" }), admin)).toBe(false);
    expect(taskOpensInPlace(item({ kind: "opportunity" }), admin)).toBe(false);
    expect(taskOpensInPlace(item({ kind: "bid" }), admin)).toBe(false);
  });
  it("Oct 15: nobody's task does not open for a viewer who can neither Claim nor assign it", () => {
    const un = task({ unassigned: true, assigneeId: null, assigneeName: null });
    // Admins and managers assign it; a ticked office person claims it: the row opens.
    expect(taskOpensInPlace(un, admin)).toBe(true);
    expect(taskOpensInPlace(un, manager)).toBe(true);
    expect(taskOpensInPlace(un, { ...office, technician: true })).toBe(true);
    // The office or sales without the tick: getTask would refuse ("Claim it first") — no button.
    expect(taskOpensInPlace(un, office)).toBe(false);
    expect(taskOpensInPlace(un, customersOnly)).toBe(false);
    expect(taskOpensInPlace(un, { ...customersOnly, access: ["estimate", "invoices"] })).toBe(
      false,
    );
    expect(taskOpensInPlace(un, null)).toBe(false);
    // An assigned task opens for its assignee, as before.
    expect(taskOpensInPlace(task({ assigneeId: ME }), office)).toBe(true);
    expect(taskOpensInPlace(task({ assigneeId: BOB }), office)).toBe(true);
    expect(UNASSIGNED_TASK_HINT).toBe("Claim it, or ask a manager to assign it");
  });
  it("the page: such a row is plain text with the hint, keeps its flags and Open on map", () => {
    const page = read("src/components/my-work-page.tsx");
    const row = page.slice(
      page.indexOf("function WorkRow("),
      page.indexOf("function WaitingSince"),
    );
    expect(row).toContain("const act = actions && actions.opensInPlace(item) ? actions : null;");
    expect(row).toContain('const inert = !!actions && item.kind === "task" && !act;');
    expect(row).toContain("const mapHref = act || inert ? taskMapHref(item) : null;");
    expect(row).toContain(') : inert ? (\n        <div className="p-3" data-row="inert-task">');
    expect(row).toContain("{UNASSIGNED_TASK_HINT}");
    // The same body (title, badge, Unassigned / Overdue flags) as every other row.
    expect(row.match(/\{body\}/g)).toHaveLength(3);
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toContain("opensInPlace: (item) => taskOpensInPlace(item, profile),");
  });
  it("the map stays one click away for a task with a building, not for one without", () => {
    expect(taskMapHref(task({ href: "/prospect?building=b1" }))).toBe("/prospect?building=b1");
    expect(taskMapHref(task({ href: "/prospect" }))).toBeNull();
    expect(taskMapHref(item({ kind: "ticket", href: "/service?id=t1&building=x" }))).toBeNull();
  });
  it("the id behind a row", () => {
    expect(workId({ key: "task:k1" })).toBe("k1");
    expect(workId({ key: "ticket:abc:def" })).toBe("abc:def");
  });
  it("the page: a task row is a button that opens the task; the other kinds keep their link", () => {
    const page = read("src/components/my-work-page.tsx");
    const row = page.slice(
      page.indexOf("function WorkRow("),
      page.indexOf("function WaitingSince"),
    );
    expect(row).toContain("const act = actions && actions.opensInPlace(item) ? actions : null;");
    expect(row).toContain("onClick={() => act.openTask(item)}");
    expect(row).toContain(
      '<button\n          type="button"\n          className="block w-full p-3 text-left"',
    );
    // The other kinds: still a real link, with the browser's modifier-clicks.
    expect(row).toContain(
      '<a href={item.href} className="block p-3" onClick={followLink(navigate, item.href)}>',
    );
    expect(page).toContain(
      "if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;",
    );
    // "Open on map" for a task with a building.
    expect(row).toContain("const mapHref = act || inert ? taskMapHref(item) : null;");
    expect(row).toContain("Open on map");
    // The edit dialog is the TaskDialog on the fetched row; the hook fetches the whole task.
    expect(page).toContain("task={editTask ?? undefined}");
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toContain("getTaskFn({ data: { id } })");
    const fns = read("src/lib/tasks.functions.ts");
    expect(fns).toContain("export const getTask = createServerFn");
    expect(fns).toContain("if (!canSeeTask(profile, row))");
  });
});

describe("the Done tick on a task row", () => {
  it("for whoever may change the task: the assignee, or an admin / manager; never another kind", () => {
    expect(canEditWorkTask(task({ assigneeId: ME }), office)).toBe(true);
    expect(canEditWorkTask(task({ assigneeId: BOB }), office)).toBe(false);
    expect(canEditWorkTask(task({ assigneeId: BOB }), manager)).toBe(true);
    expect(canEditWorkTask(task({ assigneeId: null, unassigned: true }), office)).toBe(false);
    expect(canEditWorkTask(task({ assigneeId: null, unassigned: true }), admin)).toBe(true);
    expect(canEditWorkTask(item({ kind: "ticket", assigneeId: ME }), admin)).toBe(false);
    expect(canEditWorkTask(task(), null)).toBe(false);
    expect(canEditWorkTask(task(), { role: "user", access: [], technician: false })).toBe(false);
  });
  it("the page: a checkbox wired to setTaskStatus, the toast's Undo reopening it, no confirm", () => {
    const page = read("src/components/my-work-page.tsx");
    const row = page.slice(
      page.indexOf("function WorkRow("),
      page.indexOf("function WaitingSince"),
    );
    expect(row).toContain("const tick = !!act && act.canEditTask(item);");
    expect(row).toContain('<label className="flex items-center gap-2" data-tick="task">');
    expect(row).toContain("if (v === true) act.markDone(item);");
    expect(row).not.toContain("AlertDialog");
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toContain("const statusFn = useServerFn(setTaskStatus);");
    expect(hook).toContain(
      'markDone: (item) => status.mutate({ id: workId(item), status: "done" }),',
    );
    expect(hook).toContain(
      'action: { label: "Undo", onClick: () => status.mutate({ id: v.id, status: "open" }) },',
    );
    expect(hook).toContain('queryKey: ["my-work"]');
    expect(hook).toContain("canEditTask: (item) => canEditWorkTask(item, profile),");
  });
});

describe("dropPlan: drag an assigned ticket or task onto another day", () => {
  const DAY = "2026-10-21";
  it("a ticket for whoever dispatches: its technician unchanged, the new day", () => {
    const t = item({ kind: "ticket", assigneeId: BOB, date: "2026-10-20" });
    expect(dropPlan(t, DAY, office)).toEqual({
      kind: "ticket",
      id: "t1",
      technicianId: BOB,
      date: DAY,
    });
    expect(dropPlan(item({ kind: "inspection" }), DAY, manager)).toMatchObject({ kind: "ticket" });
    expect(dropPlan(t, DAY, admin)).not.toBeNull();
  });
  it("no permission → null (a Customers-only user, a technician, nobody signed in)", () => {
    expect(dropPlan(item({}), DAY, customersOnly)).toBeNull();
    expect(dropPlan(item({}), DAY, tech)).toBeNull();
    expect(dropPlan(item({}), DAY, null)).toBeNull();
  });
  it("the same day → null; a bad day → null", () => {
    expect(dropPlan(item({ date: DAY }), DAY, admin)).toBeNull();
    expect(dropPlan(item({}), "tomorrow", admin)).toBeNull();
  });
  it("a follow-up, an opportunity or a bid → null, whoever drags", () => {
    expect(dropPlan(item({ kind: "followup" }), DAY, admin)).toBeNull();
    expect(dropPlan(item({ kind: "opportunity" }), DAY, admin)).toBeNull();
    expect(dropPlan(item({ kind: "bid" }), DAY, admin)).toBeNull();
  });
  it("nobody's work, finished work and the office's queues are not moved this way", () => {
    expect(dropPlan(item({ unassigned: true, assigneeId: null }), DAY, admin)).toBeNull();
    expect(dropPlan(item({ done: true }), DAY, admin)).toBeNull();
    expect(dropPlan(item({ needsAuth: true }), DAY, admin)).toBeNull();
    expect(dropPlan(item({ toInvoice: true }), DAY, admin)).toBeNull();
    // A ticket row without a technician that is somehow not flagged unassigned: nothing to keep.
    expect(dropPlan(item({ assigneeId: null }), DAY, admin)).toBeNull();
  });
  it("a task: its assignee or a manager; another person's task is not a plain user's to move", () => {
    expect(dropPlan(task({ assigneeId: ME }), DAY, office)).toEqual({
      kind: "task",
      id: "k1",
      date: DAY,
    });
    expect(dropPlan(task({ assigneeId: BOB }), DAY, office)).toBeNull();
    expect(dropPlan(task({ assigneeId: BOB }), DAY, manager)).toEqual({
      kind: "task",
      id: "k1",
      date: DAY,
    });
    expect(canMoveWork(task({ assigneeId: ME }), tech)).toBe(true);
  });
  it("the page: cell items and the day's rows drag when movable; a drop moves or claims", () => {
    const page = read("src/components/my-work-page.tsx");
    const cal = page.slice(page.indexOf("function CalendarView"), page.indexOf("export function"));
    expect(cal).toContain("draggable={!!actions?.movable(i)}");
    expect(cal).toContain("actions?.movable(it) ? (");
    expect(cal).toContain("const dropTargets = !!claim || !!actions;");
    expect(cal).toContain("if (claim) claim(it, d);");
    expect(cal).toContain("} else actions?.move(it, d);");
    // The Unassigned aside still claims by drop; nothing else moves a follow-up or an opportunity.
    expect(cal).not.toContain("const it = unassigned.find((u) => u.key === key);");
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toContain("movable: (item) => canMoveWork(item, profile),");
    expect(hook).toContain("const plan = dropPlan(item, day, profile);");
    expect(hook).toContain("technician_id: plan.technicianId, scheduled_date: plan.date");
    expect(hook).toContain("moveTaskFn({ data: { id: plan.id, date: plan.date } })");
    expect(hook).toContain("toast.success(`Moved to ${monthDay(plan.date)}`);");
    const fns = read("src/lib/tasks.functions.ts");
    expect(fns).toContain("export const moveTaskDate = createServerFn");
    expect(fns).toContain("const cur = await loadVisible(context, data.id, profile);");
  });
  it('"Oct 21" for the toast', () => {
    expect(monthDay("2026-10-21")).toBe("Oct 21");
    expect(monthDay("2026-01-05")).toBe("Jan 5");
  });
});

describe("assignPlan: Assign to… on an Unassigned row", () => {
  const unTicket = item({ unassigned: true, assigneeId: null, assigneeName: null });
  const unTask = task({ unassigned: true, assigneeId: null, assigneeName: null, date: null });
  const unOpp = item({
    key: "opportunity:o1",
    kind: "opportunity",
    unassigned: true,
    assigneeId: null,
    assigneeName: null,
  });
  it("the permission matrix", () => {
    // Tickets: whoever dispatches.
    expect(assignKind(unTicket, admin)).toBe("ticket");
    expect(assignKind(unTicket, manager)).toBe("ticket");
    expect(assignKind(unTicket, office)).toBe("ticket");
    expect(assignKind(unTicket, customersOnly)).toBeNull();
    expect(assignKind(unTicket, tech)).toBeNull();
    // Tasks and opportunities: admins and managers (seesEveryone).
    expect(assignKind(unTask, admin)).toBe("task");
    expect(assignKind(unTask, manager)).toBe("task");
    expect(assignKind(unTask, office)).toBeNull();
    expect(assignKind(unOpp, manager)).toBe("opportunity");
    expect(assignKind(unOpp, office)).toBeNull();
    expect(assignKind(unOpp, null)).toBeNull();
    // Only nobody's work; never a follow-up or a bid.
    expect(assignKind(item({ assigneeId: BOB }), admin)).toBeNull();
    expect(assignKind(item({ kind: "followup", unassigned: true }), admin)).toBeNull();
    expect(assignKind(item({ kind: "bid", unassigned: true }), admin)).toBeNull();
  });
  it("what is sent: a ticket keeps its day; a task or an opportunity names its assignee", () => {
    expect(assignPlan(unTicket, BOB, office)).toEqual({
      kind: "ticket",
      id: "t1",
      technicianId: BOB,
      date: "2026-10-20",
    });
    expect(assignPlan(item({ ...unTicket, date: null }), BOB, office)).toMatchObject({
      date: null,
    });
    expect(assignPlan(unTask, BOB, manager)).toEqual({ kind: "task", id: "k1", assignee: BOB });
    expect(assignPlan(unOpp, BOB, admin)).toEqual({
      kind: "opportunity",
      id: "o1",
      assignee: BOB,
    });
    expect(assignPlan(unTask, BOB, office)).toBeNull();
    expect(assignPlan(unTask, "", manager)).toBeNull();
  });
  it("the page: the select beside Claim, rosters loaded when a select opens, the server functions", () => {
    const page = read("src/components/my-work-page.tsx");
    const row = page.slice(
      page.indexOf("function WorkRow("),
      page.indexOf("function WaitingSince"),
    );
    expect(row).toContain(
      "const assignNode = item.unassigned && actions ? actions.assign(item) : null;",
    );
    expect(row).toContain("{assignNode}\n            {showClaim && (");
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toContain("const kind = assignKind(item, profile);");
    expect(hook).toContain("const plan = assignPlan(item, id, profile);");
    expect(hook).toContain('enabled: wanted.includes("ticket"),');
    expect(hook).toContain('enabled: wanted.includes("task"),');
    expect(hook).toContain('enabled: wanted.includes("opportunity"),');
    expect(hook).toContain("onOpen={() => want(kind)}");
    expect(hook).toContain("useServerFn(listTechnicians)");
    expect(hook).toContain("useServerFn(listAssignableUsers)");
    expect(hook).toContain("useServerFn(listAssigneeOptions)");
    const select = read("src/components/work-assign-select.tsx");
    expect(select).toContain('<SelectValue placeholder="Assign to…" />');
    expect(select).toContain("if (o) onOpen();");
    const tasks = read("src/lib/tasks.functions.ts");
    expect(tasks).toContain("export const assignTask = createServerFn");
    expect(tasks).toContain("if (!seesEveryone(p)) throw new Error(");
    expect(tasks).toContain('.is("assignee", null)');
    const opps = read("src/lib/opportunities.functions.ts");
    expect(opps).toContain("export const assignOpportunity = createServerFn");
    expect(opps.slice(opps.indexOf("export const assignOpportunity"))).toContain(
      "if (!seesEveryone(p))",
    );
  });
});

describe("the toolbar's New ticket / New opportunity", () => {
  it("the links: a blank ticket, dated on the Calendar's selected day", () => {
    expect(newTicketHref(null)).toBe("/service?new=1");
    expect(newTicketHref(undefined)).toBe("/service?new=1");
    expect(newTicketHref("2026-10-21")).toBe("/service?new=1&date=2026-10-21");
    expect(newTicketHref("not a day")).toBe("/service?new=1");
    expect(NEW_OPPORTUNITY_HREF).toBe("/opportunities?new=1");
  });
  it("the routes honour them", () => {
    const service = read("src/lib/service-search.ts");
    expect(service).toContain('...(typeof date === "string" && YMD.test(date) ? { date } : {}),');
    const servicePage = read("src/components/service-page.tsx");
    expect(servicePage).toContain("scheduled_date: prefill.date ?? d.scheduled_date,");
    const opps = read("src/lib/opportunities-search.ts");
    expect(opps).toContain('if (isOne(s["new"])) return { new: 1 };');
  });
  it("the page: the gates, the hrefs, the selected day into New task", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain("const showNewTicket = dispatchesTickets(profile);");
    expect(page).toContain("const showNewOpportunity = seesOpportunitiesList(profile);");
    expect(page).toContain('const newDay = view === "calendar" ? calDay : null;');
    expect(page).toContain("{showNewTicket && (");
    expect(page).toContain(
      "<a href={newTicketHref(newDay)} onClick={followLink(navigate, newTicketHref(newDay))}>",
    );
    expect(page).toContain("{showNewOpportunity && (");
    expect(page).toContain(
      "<a href={NEW_OPPORTUNITY_HREF} onClick={followLink(navigate, NEW_OPPORTUNITY_HREF)}>",
    );
    expect(page).toContain("New ticket");
    expect(page).toContain("New opportunity");
    expect(page).toContain("defaults={newDay ? { date: newDay } : undefined}");
    // The Calendar's selected day is the page's.
    expect(page).toContain("day={calDay}");
    expect(page).toContain("onDay={setCalDay}");
    const cal = page.slice(page.indexOf("function CalendarView"), page.indexOf("export function"));
    expect(cal).not.toContain("const [day, setDay] = useState(today);");
  });
});
