/**
 * Owner, Nov 13, after assigning a ticket to himself and hearing nothing: "notifications should
 * go out to myself even if im the one who did it."
 *
 * The rule was "never the person who made the change". It still is for everyone who has not
 * asked otherwise: a new switch on My account, "My own changes" (profiles.notify_own), off by
 * default. Proven in a browser on two temporary tickets the test login assigned to itself: with
 * the switch off no notice was written, with it on exactly one "Assigned to you" was.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { Client } from "./notify.server";
import { actorIsTold, OWN_NOTICES_HELP, OWN_NOTICES_LABEL, withoutActor } from "./own-notices";
import { exceptActor, wantsOwnNotices } from "./own-notices.server";
import { noticeRecipients } from "./tasks";

const read = (p: string) => readFileSync(p, "utf8");

/** A stand-in for the database client: answers the one profile read. */
function fakeClient(answer: { data?: unknown; error?: unknown } | Error) {
  const maybeSingle = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return { data: answer.data ?? null, error: answer.error ?? null };
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { sb: { from } as unknown as Client, from, select, eq, maybeSingle };
}

describe("who is left out", () => {
  it("the person who made the change, as before", () => {
    expect(withoutActor(["a", "me", "b"], "me", false)).toEqual(["a", "b"]);
  });
  it("nobody, when that person asked to hear about their own changes", () => {
    expect(withoutActor(["a", "me", "b"], "me", true)).toEqual(["a", "me", "b"]);
  });
  it("nobody is added: someone who was not going to be told still is not", () => {
    expect(withoutActor(["a", "b"], "me", true)).toEqual(["a", "b"]);
    expect(withoutActor([], "me", true)).toEqual([]);
  });
  it("an unknown actor leaves the list as it is", () => {
    expect(withoutActor(["a", "b"], null, false)).toEqual(["a", "b"]);
  });
  it("one recipient: told unless they are the actor without the switch", () => {
    expect(actorIsTold("tech", "office", false)).toBe(true);
    expect(actorIsTold("me", "me", false)).toBe(false);
    expect(actorIsTold("me", "me", true)).toBe(true);
    expect(actorIsTold(null, "me", true)).toBe(false);
  });
});

describe("reading the switch", () => {
  it("on only when the row says true", async () => {
    expect(await wantsOwnNotices(fakeClient({ data: { notify_own: true } }).sb, "me")).toBe(true);
    expect(await wantsOwnNotices(fakeClient({ data: { notify_own: false } }).sb, "me")).toBe(false);
    expect(await wantsOwnNotices(fakeClient({ data: { notify_own: null } }).sb, "me")).toBe(false);
    expect(await wantsOwnNotices(fakeClient({ data: null }).sb, "me")).toBe(false);
  });
  it("any doubt is a no: a failed read, a thrown error, nobody to ask about", async () => {
    expect(
      await wantsOwnNotices(fakeClient({ error: { message: "column does not exist" } }).sb, "me"),
    ).toBe(false);
    expect(await wantsOwnNotices(fakeClient(new Error("network")).sb, "me")).toBe(false);
    const c = fakeClient({ data: { notify_own: true } });
    expect(await wantsOwnNotices(c.sb, null)).toBe(false);
    expect(c.from).not.toHaveBeenCalled();
  });
  it("reads that one person's own row", async () => {
    const c = fakeClient({ data: { notify_own: true } });
    await wantsOwnNotices(c.sb, "me");
    expect(c.from).toHaveBeenCalledWith("profiles");
    expect(c.select).toHaveBeenCalledWith("notify_own");
    expect(c.eq).toHaveBeenCalledWith("id", "me");
  });
  it("is not read at all when the actor is not among those to tell", async () => {
    const c = fakeClient({ data: { notify_own: true } });
    expect(await exceptActor(["a", "b"], "me", c.sb)).toEqual(["a", "b"]);
    expect(c.from).not.toHaveBeenCalled();
  });
  it("the actor stays on the list with the switch on, and is dropped with it off", async () => {
    expect(
      await exceptActor(["a", "me"], "me", fakeClient({ data: { notify_own: true } }).sb),
    ).toEqual(["a", "me"]);
    expect(
      await exceptActor(["a", "me"], "me", fakeClient({ data: { notify_own: false } }).sb),
    ).toEqual(["a"]);
  });
});

describe("every sender uses it", () => {
  it("Assigned to you (tickets, opportunities, the review timer)", () => {
    const f = read("src/lib/followups.server.ts");
    expect(f).toContain("if (!a.assigneeId || a.quiet) return;");
    expect(f).toContain(
      "if (a.assigneeId === a.actorId && !(await wantsOwnNotices(admin, a.actorId))) return;",
    );
    expect(f).not.toContain("a.assigneeId === a.actorId || a.quiet");
  });
  it("a ticket marked done, and one authorized", () => {
    const t = read("src/lib/ticket-events.server.ts");
    expect(t).toContain("const others = await exceptActor(reviewers, actor.id, admin);");
    expect(t).toMatch(
      /const others = await exceptActor\(\s*office\.map\(\(u\) => u\.id\),\s*actor\.id,\s*admin,\s*\);/,
    );
    expect(t).not.toContain(".filter((id) => id !== actor.id)");
  });
  it("a ticket reassigned, and its day moved", () => {
    const t = read("src/lib/ticket-events.server.ts");
    expect(t).toContain(
      "(before.technician_id !== actor.id || (await wantsOwnNotices(admin, actor.id)))",
    );
    expect(t).toContain(
      "if (row.technician_id === actor.id && !(await wantsOwnNotices(admin, actor.id))) return;",
    );
  });
  it("a new task, a task taken, and a mention", () => {
    const tasks = read("src/lib/tasks.functions.ts");
    expect(tasks).toContain(
      "const skip = (await wantsOwnNotices(sb, context.userId)) ? null : context.userId;",
    );
    expect(tasks).toContain(': noticeRecipients(row, "created", skip);');
    expect(tasks).toContain("users: await exceptActor(added.users, context.userId, sb)");
    expect(tasks).not.toContain("u !== context.userId");
    for (const f of ["src/lib/mention-notify.ts", "src/lib/service-field.functions.ts"]) {
      const text = read(f);
      expect(text).toContain("await exceptActor(");
      expect(text).not.toMatch(/\.filter\(\(id\) => id !== (ctx|context)\.userId\)/);
    }
  });
  it("a task's own rule keeps whoever saved it when no one is to be skipped", () => {
    const task = { attendees: ["me", "a"], external_emails: [], assignee: "me", created_by: "me" };
    expect(noticeRecipients(task, "created", "me").users).toEqual(["a"]);
    expect(noticeRecipients(task, "created", null).users).toEqual(["me", "a"]);
  });
});

describe("the switch on My account", () => {
  const page = read("src/routes/account.tsx");
  it("has its own row, label and one line of help", () => {
    expect(OWN_NOTICES_LABEL).toBe("My own changes");
    expect(OWN_NOTICES_HELP).toContain("Off unless you want it.");
    expect(page).toContain('data-row="notify-own"');
    expect(page).toContain('<Label htmlFor="notify-own">{OWN_NOTICES_LABEL}</Label>');
  });
  it("is off until read, and saves the moment it is flipped", () => {
    expect(page).toContain("checked={own.data?.notify_own ?? false}");
    expect(page).toContain("onCheckedChange={(v) => saveOwn.mutate(v)}");
  });
  it("saves through the caller's own row and takes only the value asked for", () => {
    const fns = read("src/lib/followups.functions.ts");
    expect(fns).toContain('context.supabase.rpc("set_my_notify_own", {');
    expect(fns).toContain("if (error || saved !== data.on) throw new Error(PREFS_NOT_SAVED);");
  });
});

describe("the database (supabase/migrations/20261113200000_notify_own.sql)", () => {
  const sql = read("supabase/migrations/20261113200000_notify_own.sql");
  it("the switch is off for everyone until they turn it on", () => {
    expect(sql).toContain(
      "alter table public.profiles add column if not exists notify_own boolean not null default false;",
    );
  });
  it("a person can set only their own, and must be signed in", () => {
    expect(sql).toContain("where p.id = auth.uid()");
    expect(sql).toContain("if auth.uid() is null then");
    expect(sql).toContain(
      "revoke all on function public.set_my_notify_own(boolean) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.set_my_notify_own(boolean) to authenticated;",
    );
  });
  it("the types know the column and the function", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types.match(/ {10}notify_own\??: boolean\n/g)).toHaveLength(3);
    expect(types).toContain("set_my_notify_own: { Args: { p_on: boolean }; Returns: boolean }");
  });
});
