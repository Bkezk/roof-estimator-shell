import { describe, expect, it } from "vitest";

import {
  addedAttendees,
  attendeeList,
  bucketTasks,
  buildTaskEmail,
  canSeeTask,
  cleanEmails,
  dueAtFor,
  dueTaskNotices,
  isValidEmail,
  noticeRecipients,
  taskDueAt,
  taskInputSchema,
  taskToInput,
  taskWhenText,
  zonedTime,
  type NoticeFields,
  type TaskRow,
} from "./tasks";

const TZ = "America/New_York";
// 2026-10-02 is a Friday; Eastern is UTC-4 (EDT) then.
const et = (ymd: string, hm: string) => zonedTime(ymd, hm, TZ);

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  title: "Walk the roof",
  details: null,
  due_date: "2026-10-02",
  due_at: et("2026-10-02", "08:00").toISOString(),
  all_day: true,
  assignee: "u-bob",
  assignee_name: "Bob",
  attendees: ["u-bob"],
  external_emails: [],
  account_id: null,
  account_name: null,
  site_id: null,
  site_name: null,
  building_id: null,
  status: "open",
  source: "manual",
  created_by: "u-ann",
  created_by_name: "Ann",
  created_at: et("2026-09-30", "10:00").toISOString(),
  updated_at: et("2026-09-30", "10:00").toISOString(),
  done_at: null,
  done_by: null,
  done_by_name: null,
  notified_created_at: null,
  notified_morning_at: null,
  notified_overdue_at: null,
  notify_error: null,
  ...over,
});
const kinds = (t: NoticeFields, now: Date) =>
  dueTaskNotices(t, now, TZ).map((n) => (n.silent ? `${n.kind}(silent)` : n.kind));

describe("zonedTime", () => {
  it("reads a wall-clock time in Eastern, across daylight saving", () => {
    expect(et("2026-10-02", "08:00").toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(et("2026-12-02", "08:00").toISOString()).toBe("2026-12-02T13:00:00.000Z");
  });
});

describe("dueTaskNotices", () => {
  it("sends the created notice once", () => {
    const t = task();
    expect(kinds(t, et("2026-09-30", "10:05"))).toEqual(["created"]);
    expect(
      kinds(
        { ...t, notified_created_at: et("2026-09-30", "10:00").toISOString() },
        et("2026-09-30", "10:05"),
      ),
    ).toEqual([]);
  });

  it("sends the morning-of notice only on/after 07:00 local on the due day", () => {
    const t = task({ notified_created_at: et("2026-09-30", "10:00").toISOString() });
    expect(kinds(t, et("2026-10-01", "23:59"))).toEqual([]);
    expect(kinds(t, et("2026-10-02", "06:59"))).toEqual([]);
    expect(kinds(t, et("2026-10-02", "07:00"))).toEqual(["morning"]);
    expect(kinds(t, et("2026-10-02", "13:30"))).toEqual(["morning"]);
    // Once.
    expect(
      kinds(
        { ...t, notified_morning_at: et("2026-10-02", "07:00").toISOString() },
        et("2026-10-02", "13:30"),
      ),
    ).toEqual([]);
  });

  it("uses due_date at 08:00 local when due_at is missing (older rows)", () => {
    const t = task({ due_at: null, notified_created_at: et("2026-09-30", "10:00").toISOString() });
    expect(kinds(t, et("2026-10-02", "06:30"))).toEqual([]);
    expect(kinds(t, et("2026-10-02", "07:30"))).toEqual(["morning"]);
  });

  it("sends the morning-after notice only if still open, on/after 07:00 the next day, once", () => {
    const sent = {
      notified_created_at: et("2026-09-30", "10:00").toISOString(),
      notified_morning_at: et("2026-10-02", "07:00").toISOString(),
    };
    const t = task(sent);
    expect(kinds(t, et("2026-10-02", "23:00"))).toEqual([]);
    expect(kinds(t, et("2026-10-03", "06:59"))).toEqual([]);
    expect(kinds(t, et("2026-10-03", "07:00"))).toEqual(["overdue"]);
    expect(
      kinds(
        { ...t, notified_overdue_at: et("2026-10-03", "07:00").toISOString() },
        et("2026-10-04", "09:00"),
      ),
    ).toEqual([]);
    expect(kinds({ ...t, status: "done" }, et("2026-10-03", "07:00"))).toEqual([]);
  });

  it("gives a done task nothing, not even the created notice", () => {
    expect(kinds(task({ status: "done" }), et("2026-10-05", "09:00"))).toEqual([]);
  });

  it("a missed due day: the morning-of is stamped silently and the overdue one is sent", () => {
    const t = task({ notified_created_at: et("2026-09-30", "10:00").toISOString() });
    expect(kinds(t, et("2026-10-03", "08:00"))).toEqual(["morning(silent)", "overdue"]);
  });

  it("a task made that morning or later: the New task email covers the morning-of", () => {
    const t = task({
      created_at: et("2026-10-02", "10:00").toISOString(),
      notified_created_at: et("2026-10-02", "10:00").toISOString(),
    });
    expect(kinds(t, et("2026-10-02", "10:30"))).toEqual(["morning(silent)"]);
    // Made with a date already past: no morning-after either.
    const late = task({
      created_at: et("2026-10-05", "10:00").toISOString(),
      notified_created_at: et("2026-10-05", "10:00").toISOString(),
    });
    expect(kinds(late, et("2026-10-05", "10:30"))).toEqual(["morning(silent)", "overdue(silent)"]);
  });

  it("gives an undated task only the created notice", () => {
    const t = task({ due_at: null, due_date: null });
    expect(kinds(t, et("2026-12-01", "09:00"))).toEqual(["created"]);
  });
});

describe("bucketTasks", () => {
  const now = et("2026-10-02", "09:00"); // Friday
  const at = (ymd: string, title: string, over: Partial<TaskRow> = {}) =>
    task({ title, due_date: ymd, due_at: et(ymd, "08:00").toISOString(), ...over });
  it("groups open tasks Overdue / Today / This week / Later by their local day", () => {
    const b = bucketTasks(
      [
        at("2026-10-01", "yesterday"),
        at("2026-10-02", "today late", {
          due_at: et("2026-10-02", "23:30").toISOString(),
          all_day: false,
        }),
        at("2026-10-02", "today"),
        at("2026-10-08", "in six days"),
        at("2026-10-09", "in seven days"),
        task({ title: "undated", due_at: null, due_date: null }),
        at("2026-09-20", "done long ago", { status: "done" }),
        // due_at null (older writer): the date alone decides.
        task({ title: "old row", due_at: null, due_date: "2026-10-03" }),
      ],
      now,
      TZ,
    );
    const titles = (k: keyof typeof b) => b[k].map((t) => t.title);
    expect(titles("overdue")).toEqual(["yesterday"]);
    expect(titles("today")).toEqual(["today", "today late"]);
    expect(titles("week")).toEqual(["old row", "in six days"]);
    expect(titles("later")).toEqual(["in seven days", "undated"]);
  });
  it("a timed task late in the evening stays on its Eastern day (not the UTC one)", () => {
    // 23:30 EDT on Oct 2 is 03:30 UTC on Oct 3.
    const t = at("2026-10-02", "late", {
      due_at: et("2026-10-02", "23:30").toISOString(),
      all_day: false,
    });
    expect(bucketTasks([t], now, TZ).today.map((x) => x.title)).toEqual(["late"]);
  });
});

describe("buildTaskEmail", () => {
  const t = task({
    title: "Meet the owner about the leak",
    account_name: "Bell County BOE",
    site_name: "Yellow Creek Elementary",
    due_at: et("2026-10-02", "14:30").toISOString(),
    all_day: false,
    details: "Bring the core cutter.",
  });
  it("writes company, property, when, who and notes; users get the /my-work link", () => {
    const e = buildTaskEmail(t, "created", { audience: "user", tz: TZ });
    expect(e.subject).toBe("New task: Meet the owner about the leak");
    expect(e.body).toContain("Company: Bell County BOE");
    expect(e.body).toContain("Property: Yellow Creek Elementary");
    expect(e.body).toContain("When: Fri, Oct 2, 2026 at 2:30 PM");
    expect(e.body).toContain("Assigned by: Ann");
    expect(e.body).toContain("Notes:\nBring the core cutter.");
    expect(e.url).toBe("/my-work");
  });
  it("the outside version is the same text with no link", () => {
    const e = buildTaskEmail(t, "created", { audience: "outside", tz: TZ });
    expect(e.url).toBeNull();
    expect(e.text).toContain("Company: Bell County BOE");
    expect(e.text).toContain("When: Fri, Oct 2, 2026 at 2:30 PM");
    expect(e.text).not.toMatch(/my-work|https?:|Open:/);
  });
  it("all day shows the date only; a map building stands in for the property", () => {
    const e = buildTaskEmail(task({ site_name: null }), "morning", {
      audience: "user",
      buildingLabel: "123 Main St, Corbin",
      tz: TZ,
    });
    expect(e.subject).toBe("Today: Walk the roof");
    expect(e.body).toContain("When: Fri, Oct 2, 2026 (all day)");
    expect(e.body).toContain("Property: 123 Main St, Corbin");
    expect(e.body).not.toContain("Company:");
    expect(buildTaskEmail(task(), "overdue", { audience: "user", tz: TZ }).subject).toBe(
      "Overdue: Walk the roof",
    );
  });
});

describe("noticeRecipients", () => {
  const t = task({
    assignee: "u-bob",
    attendees: ["u-ann", "u-cat"],
    external_emails: ["owner@school.org", "bad address"],
  });
  it("New task: attendees and the assignee but not whoever saved it, plus valid outside emails", () => {
    expect(noticeRecipients(t, "created", "u-ann")).toEqual({
      users: ["u-cat", "u-bob"],
      emails: ["owner@school.org"],
    });
  });
  it("morning-of: everyone; morning-after: attendees only, no outside emails", () => {
    expect(noticeRecipients(t, "morning", "u-ann").users).toEqual(["u-ann", "u-cat", "u-bob"]);
    expect(noticeRecipients(t, "morning", "u-ann").emails).toEqual(["owner@school.org"]);
    expect(noticeRecipients(t, "overdue", "u-ann")).toEqual({
      users: ["u-ann", "u-cat", "u-bob"],
      emails: [],
    });
  });
});

describe("canSeeTask", () => {
  const t = task({ created_by: "u-ann", assignee: "u-bob", attendees: ["u-bob", "u-cat"] });
  it("the creator, the assignee and attendees see it; others do not", () => {
    expect(canSeeTask({ id: "u-ann", role: "user" }, t)).toBe(true);
    expect(canSeeTask({ id: "u-bob", role: "user" }, t)).toBe(true);
    expect(canSeeTask({ id: "u-cat", role: "user" }, t)).toBe(true);
    expect(canSeeTask({ id: "u-dan", role: "user" }, t)).toBe(false);
    expect(canSeeTask(null, t)).toBe(false);
  });
  it("admins and managers see every task", () => {
    expect(canSeeTask({ id: "u-dan", role: "admin" }, t)).toBe(true);
    expect(canSeeTask({ id: "u-dan", role: "manager" }, t)).toBe(true);
  });
});

describe("input helpers", () => {
  it("validates emails before anything is sent", () => {
    expect(isValidEmail("owner@school.k12.ky.us")).toBe(true);
    for (const bad of ["", "owner", "owner@", "a@b", "a b@c.com", "a@b.com, c@d.com", "<a@b.com>"])
      expect(isValidEmail(bad)).toBe(false);
    expect(cleanEmails([" A@B.com ", "a@b.com", "nope"])).toEqual(["a@b.com"]);
    expect(() => taskInputSchema.parse({ title: "x", external_emails: ["not an email"] })).toThrow(
      /Not a valid email address: not an email/,
    );
  });
  it("the assignee is always an attendee", () => {
    expect(attendeeList("u-bob", ["u-ann", "u-ann"])).toEqual(["u-ann", "u-bob"]);
    expect(attendeeList(null, [])).toEqual([]);
  });
  it("due_at: all day is 08:00 Eastern; a time is taken as Eastern", () => {
    expect(dueAtFor({ date: "2026-10-02", time: "14:30", all_day: true })).toBe(
      "2026-10-02T12:00:00.000Z",
    );
    expect(dueAtFor({ date: "2026-10-02", time: "14:30", all_day: false })).toBe(
      "2026-10-02T18:30:00.000Z",
    );
    expect(dueAtFor({ date: null, time: null, all_day: true })).toBeNull();
  });
  it("round-trips a row into the dialog's input", () => {
    const i = taskToInput(
      task({ due_at: et("2026-10-02", "14:30").toISOString(), all_day: false }),
    );
    expect([i.date, i.time, i.all_day]).toEqual(["2026-10-02", "14:30", false]);
    expect(taskWhenText(task())).toBe("Fri, Oct 2, 2026 (all day)");
    expect(taskDueAt(task({ due_at: null }))?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });
  it("finds the attendees a save adds", () => {
    expect(
      addedAttendees(
        { attendees: ["u-bob"], external_emails: ["a@b.com"] },
        { attendees: ["u-bob", "u-cat"], external_emails: ["A@b.com", "c@d.com"] },
      ),
    ).toEqual({ users: ["u-cat"], emails: ["c@d.com"] });
    expect(addedAttendees(null, { attendees: ["u-bob"], external_emails: [] })).toEqual({
      users: ["u-bob"],
      emails: [],
    });
  });
});
