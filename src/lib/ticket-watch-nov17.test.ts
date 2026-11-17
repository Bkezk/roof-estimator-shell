/**
 * Owner, Nov 17: "someone tagged me in a note and it didnt come up as a notification on my phone.
 * also managers and owner should get all notifications, like when a ticket is opened then when
 * scheduled, done etc. is that how its currently set up?"
 *
 * It was not: a ticket told the technician it was given to, the reviewers at Done and the office
 * at Authorized, and nobody else. These check the new rule (every admin and manager hears every
 * step, once per change), the push changes (high urgency, no shared tag) and the bell's line
 * about the device.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<
    (
      ids: string[],
      msg: { kind: string; title: string; body?: string | null; url?: string | null },
      sb: unknown,
    ) => Promise<number>
  >(async () => 1),
);
const syncFollowup = vi.hoisted(() =>
  vi.fn<(a: Record<string, unknown>, sb: unknown) => Promise<string>>(async () => "started"),
);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));
vi.mock("@/lib/followups.server", () => ({ syncFollowup }));

import { afterTicketDispatch, afterTicketStage } from "./ticket-events.server";
import type { Client } from "@/lib/notify.server";
import { noticeCategory, wantsNotice } from "@/lib/notice-categories";
import { PUSH_HINT_BLOCKED, PUSH_HINT_IPHONE, PUSH_HINT_OFF, pushHint } from "@/lib/push-hint";
import {
  assignedLine,
  dispatchWatchNotice,
  stageWatchNotice,
  TICKET_WATCH_KIND,
} from "@/lib/ticket-watch";
import { PUSH_URGENCY, sendWebPush, generateVapidKeys, toBase64Url } from "@/lib/webpush";

const read = (p: string) => readFileSync(p, "utf8");

const ROSTER = [
  { id: "tech-1", full_name: "Ted Tech", email: "t@x", technician: true },
  { id: "tech-2", full_name: "Tia Tech", email: "t2@x", technician: true },
  { id: "office-1", full_name: "Olive Office", email: "o@x", technician: false },
  { id: "admin-1", full_name: "Ann Admin", email: "a@x", technician: true },
  { id: "mgr-1", full_name: "Max Manager", email: "m@x", technician: false },
];
/** Admins and managers, as ticket_authorizers() lists them. */
const WATCHERS = ["admin-1", "mgr-1"];

/** A client whose roster and authorizers answer; `own` are the people with "My own changes" on. */
function client(own: string[] = []) {
  const rpc = vi.fn(async (fn: string) =>
    fn === "ticket_authorizers" ? { data: WATCHERS, error: null } : { data: ROSTER, error: null },
  );
  const from = vi.fn(() => {
    let id = "";
    const q = {
      select: () => q,
      eq: (_c: string, v: string) => {
        id = v;
        return q;
      },
      maybeSingle: async () => ({ data: { notify_own: own.includes(id) }, error: null }),
    };
    return q;
  });
  return { rpc, from } as unknown as Client;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  number: 6074,
  customer_name: "Acme",
  description: "Leak",
  stage: "open",
  account_id: "acct-1",
  technician_id: null as string | null,
  scheduled_date: null as string | null,
  created_by: "office-1",
  deleted_at: null as string | null,
  ...over,
});
const OFFICE = { id: "office-1", name: "Olive Office" };
const watchCalls = () => notify.mock.calls.filter((c) => c[1].kind === TICKET_WATCH_KIND);

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("the words of each step", () => {
  const t = { number: 6074, customer_name: "Acme", description: "Leak" };

  it("says who has the ticket and for when", () => {
    const base = { ...t, stage: "open" };
    expect(assignedLine({ ...base, technician_id: null, scheduled_date: null }, null)).toBe(
      "Nobody is assigned yet.",
    );
    expect(assignedLine({ ...base, technician_id: "x", scheduled_date: null }, "Ted Tech")).toBe(
      "Assigned to Ted Tech, no date yet.",
    );
    expect(assignedLine({ ...base, technician_id: null, scheduled_date: "2026-11-18" }, null)).toBe(
      "Set for Nov 18, 2026, nobody assigned yet.",
    );
    expect(
      assignedLine({ ...base, technician_id: "x", scheduled_date: "2026-11-18" }, "Ted Tech"),
    ).toBe("Assigned to Ted Tech for Nov 18, 2026.");
  });

  it("a new ticket: Opened, and the technician it went to is left out (they get Assigned to you)", () => {
    const n = stageWatchNotice({
      row: { ...t, stage: "scheduled", technician_id: "tech-1", scheduled_date: "2026-11-18" },
      prevStage: null,
      deleted: false,
      who: "Olive Office",
      techName: "Ted Tech",
    });
    expect(n).toEqual({
      title: "Opened: Ticket #6074 Acme — Leak",
      body: "Olive Office opened it. Assigned to Ted Tech for Nov 18, 2026.",
      skip: ["tech-1"],
    });
  });

  it("each stage has its own word; Done has none here (the review notice says it)", () => {
    const at = (stage: string, prevStage: string, extra: Record<string, unknown> = {}) =>
      stageWatchNotice({
        row: { ...t, stage, technician_id: "tech-1", scheduled_date: "2026-11-18" },
        prevStage,
        deleted: false,
        who: "Olive Office",
        techName: "Ted Tech",
        ...extra,
      });
    expect(at("scheduled", "open")?.title).toBe("Scheduled: Ticket #6074 Acme — Leak");
    expect(at("scheduled", "open")?.skip).toEqual(["tech-1"]);
    expect(at("open", "scheduled")?.title).toBe("Back to Open: Ticket #6074 Acme — Leak");
    expect(at("done", "scheduled")).toBeNull();
    expect(at("authorized", "done")?.body).toBe("Olive Office authorized it.");
    expect(at("authorized", "done", { endsHere: true })?.body).toBe(
      "Olive Office authorized it. That completes the inspection.",
    );
    expect(at("invoiced", "authorized")?.title).toBe("Invoiced: Ticket #6074 Acme — Leak");
    expect(at("closed", "invoiced")?.body).toBe("Olive Office closed it.");
    // Back from Done or later: Reopened, and the technician hears it from the follow-up.
    const re = at("scheduled", "done");
    expect(re?.title).toBe("Reopened: Ticket #6074 Acme — Leak");
    expect(re?.body).toContain("moved it back to Scheduled from Done");
    expect(re?.skip).toEqual(["tech-1"]);
    expect(at("invoiced", "closed")?.title).toBe("Back to Invoiced: Ticket #6074 Acme — Leak");
    // Nothing moved: nothing said.
    expect(at("scheduled", "scheduled")).toBeNull();
  });

  it("a deleted ticket says so, whatever its stage", () => {
    const n = stageWatchNotice({
      row: { ...t, stage: "scheduled", technician_id: "tech-1" },
      prevStage: "scheduled",
      deleted: true,
      who: "Max Manager",
      techName: "Ted Tech",
    });
    expect(n?.title).toBe("Deleted: Ticket #6074 Acme — Leak");
    expect(n?.body).toContain("Max Manager deleted it.");
    expect(n?.skip).toEqual([]);
  });

  it("a new technician or a moved day, when the stage stayed", () => {
    const base = { ...t, stage: "scheduled" };
    const d = (
      now: { technician_id: string | null; scheduled_date: string | null },
      before: { technician_id: string | null; scheduled_date: string | null },
    ) =>
      dispatchWatchNotice({
        row: { ...base, ...now },
        before,
        who: "Olive Office",
        techName: "Tia Tech",
        oldTechName: "Ted Tech",
      });
    const day = "2026-11-18";
    expect(
      d(
        { technician_id: "tech-2", scheduled_date: day },
        { technician_id: "tech-1", scheduled_date: day },
      ),
    ).toEqual({
      title: "Reassigned: Ticket #6074 Acme — Leak",
      body: "Olive Office moved it from Ted Tech to Tia Tech.",
      skip: ["tech-1", "tech-2"],
    });
    expect(
      d(
        { technician_id: "tech-2", scheduled_date: null },
        { technician_id: null, scheduled_date: null },
      ),
    ).toEqual({
      title: "Assigned: Ticket #6074 Acme — Leak",
      body: "Olive Office assigned it to Tia Tech, no date yet.",
      skip: ["tech-2"],
    });
    expect(
      d(
        { technician_id: null, scheduled_date: day },
        { technician_id: "tech-1", scheduled_date: day },
      ),
    ).toMatchObject({ title: "Unassigned: Ticket #6074 Acme — Leak", skip: [] });
    expect(
      d(
        { technician_id: "tech-1", scheduled_date: "2026-11-20" },
        { technician_id: "tech-1", scheduled_date: day },
      ),
    ).toEqual({
      title: "Date moved: Ticket #6074 Acme — Leak",
      body: "Olive Office moved it from Nov 18, 2026 to Nov 20, 2026.",
      skip: ["tech-1"],
    });
    expect(
      d(
        { technician_id: null, scheduled_date: day },
        { technician_id: null, scheduled_date: null },
      ),
    ).toMatchObject({ title: "Date set: Ticket #6074 Acme — Leak", skip: [] });
    // Nothing changed: nothing said.
    expect(
      d(
        { technician_id: "tech-1", scheduled_date: day },
        { technician_id: "tech-1", scheduled_date: day },
      ),
    ).toBeNull();
  });
});

describe("who is told", () => {
  it("a new ticket tells every admin and manager, with a link to the ticket", async () => {
    await afterTicketStage(row(), null, OFFICE, client());
    const calls = watchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual(["admin-1", "mgr-1"]);
    expect(calls[0]![1]).toMatchObject({
      title: "Opened: Ticket #6074 Acme — Leak",
      body: "Olive Office opened it. Nobody is assigned yet.",
      url: "/service?id=job-1",
    });
  });

  it("an admin the ticket was given to gets Assigned to you, not a second notice", async () => {
    await afterTicketStage(
      row({ stage: "scheduled", technician_id: "admin-1", scheduled_date: "2026-11-18" }),
      null,
      OFFICE,
      client(),
    );
    expect(watchCalls()[0]![0]).toEqual(["mgr-1"]);
    expect(watchCalls()[0]![1].body).toBe(
      "Olive Office opened it. Assigned to Ann Admin for Nov 18, 2026.",
    );
  });

  it("the manager who made the change is told only with My own changes on", async () => {
    const MGR = { id: "mgr-1", name: "Max Manager" };
    await afterTicketStage(row(), null, MGR, client());
    expect(watchCalls()[0]![0]).toEqual(["admin-1"]);
    vi.clearAllMocks();
    await afterTicketStage(row(), null, MGR, client(["mgr-1"]));
    expect(watchCalls()[0]![0]).toEqual(["admin-1", "mgr-1"]);
  });

  it("Done sends the review notice alone: the admins and managers are its readers already", async () => {
    await afterTicketStage(
      row({ stage: "done", technician_id: "tech-1" }),
      "scheduled",
      { id: "tech-1", name: "Ted Tech" },
      client(),
    );
    expect(watchCalls()).toHaveLength(0);
    const done = notify.mock.calls.filter((c) => c[1].kind === "ticket_done");
    expect(done).toHaveLength(1);
    expect(done[0]![0]).toEqual(["admin-1", "mgr-1"]);
  });

  it("ready to invoice reaches the office AND every admin and manager, each once", async () => {
    // admin-1 is ticked Technician, so not an office user: until Nov 17 they were not told.
    await afterTicketStage(row({ stage: "authorized" }), "done", OFFICE, client());
    expect(watchCalls()).toHaveLength(0);
    const auth = notify.mock.calls.filter((c) => c[1].kind === "ticket_authorized");
    expect(auth).toHaveLength(1);
    expect([...auth[0]![0]].sort()).toEqual(["admin-1", "mgr-1"]);
    // With My own changes on, the office user who authorized it is told as well.
    vi.clearAllMocks();
    await afterTicketStage(row({ stage: "authorized" }), "done", OFFICE, client(["office-1"]));
    const again = notify.mock.calls.filter((c) => c[1].kind === "ticket_authorized");
    expect([...again[0]![0]].sort()).toEqual(["admin-1", "mgr-1", "office-1"]);
  });

  it("an authorized inspection, which told nobody, tells the admins and managers", async () => {
    await afterTicketStage(
      row({ stage: "authorized", service_type: "inspection" }),
      "done",
      OFFICE,
      client(),
    );
    expect(notify.mock.calls.filter((c) => c[1].kind === "ticket_authorized")).toHaveLength(0);
    expect(watchCalls()).toHaveLength(1);
    expect(watchCalls()[0]![1].body).toBe(
      "Olive Office authorized it. That completes the inspection.",
    );
  });

  it("invoiced and closed are told; a deleted ticket only when this step deleted it", async () => {
    await afterTicketStage(row({ stage: "invoiced" }), "authorized", OFFICE, client());
    expect(watchCalls()[0]![1].title).toBe("Invoiced: Ticket #6074 Acme — Leak");
    vi.clearAllMocks();
    await afterTicketStage(row({ stage: "closed" }), "invoiced", OFFICE, client());
    expect(watchCalls()[0]![1].title).toBe("Closed: Ticket #6074 Acme — Leak");
    vi.clearAllMocks();
    const gone = row({ stage: "scheduled", deleted_at: "2026-11-17T12:00:00Z" });
    await afterTicketStage(gone, "scheduled", OFFICE, client(), { deleted: true });
    expect(watchCalls()[0]![1].title).toBe("Deleted: Ticket #6074 Acme — Leak");
    // Any later sync of a ticket that is already deleted says nothing.
    vi.clearAllMocks();
    await afterTicketStage(gone, "open", OFFICE, client());
    expect(watchCalls()).toHaveLength(0);
  });

  it("a restore (stage unchanged) says nothing", async () => {
    await afterTicketStage(row({ stage: "scheduled" }), "scheduled", OFFICE, client());
    expect(watchCalls()).toHaveLength(0);
  });

  it("a reassignment: the two technicians get their own notices, the others the Reassigned one", async () => {
    const now = row({ stage: "scheduled", technician_id: "tech-2", scheduled_date: "2026-11-18" });
    await afterTicketDispatch(
      now,
      { technician_id: "tech-1", scheduled_date: "2026-11-18" },
      OFFICE,
      client(),
    );
    const own = notify.mock.calls.filter((c) => c[1].kind === "reassigned");
    expect(own).toHaveLength(1);
    expect(own[0]![0]).toEqual(["tech-1"]);
    expect(watchCalls()).toHaveLength(1);
    expect(watchCalls()[0]![0]).toEqual(["admin-1", "mgr-1"]);
    expect(watchCalls()[0]![1].body).toBe("Olive Office moved it from Ted Tech to Tia Tech.");
  });

  it("a moved day: the technician gets moved to, an admin who is that technician is not told twice", async () => {
    const now = row({ stage: "scheduled", technician_id: "admin-1", scheduled_date: "2026-11-20" });
    await afterTicketDispatch(
      now,
      { technician_id: "admin-1", scheduled_date: "2026-11-18" },
      OFFICE,
      client(),
    );
    expect(notify.mock.calls.filter((c) => c[1].kind === "date_moved")[0]![0]).toEqual(["admin-1"]);
    expect(watchCalls()[0]![0]).toEqual(["mgr-1"]);
    expect(watchCalls()[0]![1].title).toBe("Date moved: Ticket #6074 Acme — Leak");
  });

  it("a change that also moved the stage is told once, by the stage notice", async () => {
    const now = row({ stage: "scheduled", technician_id: "tech-1", scheduled_date: "2026-11-18" });
    await afterTicketDispatch(
      now,
      { technician_id: null, scheduled_date: null },
      OFFICE,
      client(),
      {
        stageMoved: true,
      },
    );
    expect(watchCalls()).toHaveLength(0);
  });

  it("a notice that cannot be sent is logged, never a failed save", async () => {
    notify.mockRejectedValueOnce(new Error("mail is down"));
    await expect(afterTicketStage(row(), null, OFFICE, client())).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
    expect(String(errorLog.mock.calls[0]![0])).toContain("ticket #6074");
  });

  it("every ticket path hands the step over: create, save, the board, a claim, a delete", () => {
    const src = read("src/lib/service.functions.ts");
    expect(src).toContain("const stageMoved = prevStage !== row.stage;");
    expect(src).toContain("await afterTicketDispatch(row, before, actor, sb, { stageMoved });");
    expect(src).toContain("opts.deleted ? { deleted: true } : {}");
    // The delete says it deleted; the claim hands over what the ticket was.
    expect(src).toMatch(/row\.stage,\s+undefined,\s+\{ deleted: true \},/);
    expect(src).toContain(
      "await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, sb, cur.stage, cur);",
    );
  });
});

describe("the Service notices switch covers them", () => {
  it("a ticket step is a service notice: on by default, off with the switch", () => {
    expect(noticeCategory(TICKET_WATCH_KIND, "/service?id=job-1")).toBe("service");
    expect(wantsNotice({ notify_service: true }, "service")).toBe(true);
    expect(wantsNotice({ notify_service: false }, "service")).toBe(false);
  });
});

describe("push to a phone", () => {
  it("goes out at high urgency (normal is held back on a low battery)", async () => {
    expect(PUSH_URGENCY).toBe("high");
    const keys = await generateVapidKeys();
    // A device's own key pair and secret, as a browser would hand them over.
    const device = await globalThis.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const p256dh = toBase64Url(
      new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", device.publicKey)),
    );
    const auth = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    try {
      const r = await sendWebPush(
        { endpoint: "https://web.push.apple.com/abc", p256dh, auth },
        "{}",
        { keys, subject: "mailto:x@example.com" },
      );
      expect(r.ok).toBe(true);
      const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(headers["Urgency"]).toBe("high");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("no notice shares a tag with another, so none replaces another in silence", () => {
    const src = read("src/lib/notify.server.ts");
    expect(src).not.toContain('payload.tag ?? "bid-o-matic"');
    expect(src).toContain("...(payload.tag ? { tag: payload.tag } : {}),");
    expect(src).toContain("const tag = pushTag(row.id);");
    expect(src).toMatch(/notificationId > 0 \? `jbk-\$\{notificationId\}` : undefined/);
    // The worker shows a notice with no tag as its own.
    expect(read("public/sw.js")).toContain(
      'tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,',
    );
  });
});

describe("the bell's line about this device", () => {
  it("says nothing while the state is unknown, when it is on, or once dismissed", () => {
    expect(pushHint(null, false, false)).toBeNull();
    expect(pushHint("on", false, false)).toBeNull();
    expect(pushHint("off", false, true)).toBeNull();
    expect(pushHint("unsupported", false, false)).toBeNull();
  });

  it("offers Turn on where the device can take notifications and has none", () => {
    expect(pushHint("off", false, false)).toEqual({ text: PUSH_HINT_OFF, canTurnOn: true });
  });

  it("explains a block and the iPhone Home Screen step, with no button", () => {
    expect(pushHint("denied", false, false)).toEqual({ text: PUSH_HINT_BLOCKED, canTurnOn: false });
    expect(pushHint("unsupported", true, false)).toEqual({
      text: PUSH_HINT_IPHONE,
      canTurnOn: false,
    });
    expect(pushHint("off", true, false)?.canTurnOn).toBe(false);
  });

  it("the bell shows it and keeps the device's details current once a day", () => {
    const bell = read("src/components/notifications-bell.tsx");
    expect(bell).toContain("<PushHereHint userId={userId} />");
    expect(bell).toContain("if (userId) void keepPushHere(userId);");
    const client = read("src/lib/push-client.ts");
    // Only a device that already has notifications on is saved again; none is turned on unasked.
    expect(client).toContain('if (state !== "on" || !userId) return state;');
    expect(client).toContain("if (window.localStorage.getItem(KEPT_KEY) === mark) return state;");
    // My account's Turn off stops the bell asking; Turn on lets it ask again.
    const account = read("src/routes/account.tsx");
    expect(account).toContain('window.localStorage.setItem(PUSH_HINT_OFF_KEY, "1");');
    expect(account).toContain("window.localStorage.removeItem(PUSH_HINT_OFF_KEY);");
  });
});
