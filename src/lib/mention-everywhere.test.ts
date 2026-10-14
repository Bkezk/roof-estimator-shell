/**
 * @mentions beyond the ticket note (owner, Oct 14: "Is the note the only place to tag @'s?" —
 * "Go ahead and do that"). The contact log's note (tickets and opportunities), an opportunity's
 * Notes and a customer's Notes now carry the same "@" picker and tell the people named. Every
 * check here fails on the old code: no shared box, no shared sender, and three boxes that took an
 * "@" as plain text.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sendMentions, type MentionDeps } from "@/lib/mention-notify";
import {
  mentionBody,
  MENTION_BODY_MAX,
  newMentionIds,
  NO_MENTIONS,
  toldSuffix,
} from "@/lib/mentions";
import { noticeCategory } from "@/lib/notice-categories";

const read = (p: string) => readFileSync(p, "utf8");
const people = [
  { id: "bk", name: "Brandon Keck" },
  { id: "gp", name: "Garry Peters" },
  { id: "mb", name: "Mark Barger" },
];

describe("newMentionIds: a re-saved Notes box tells only the names newly written", () => {
  it("no previous text: everyone named", () => {
    expect(newMentionIds("ask @Brandon Keck and @Garry Peters", null, people)).toEqual([
      "bk",
      "gp",
    ]);
    expect(newMentionIds("ask @Brandon Keck", undefined, people)).toEqual(["bk"]);
  });
  it("names already in the stored text are not told twice; a new one is", () => {
    const before = "ask @Brandon Keck";
    expect(newMentionIds("ask @Brandon Keck", before, people)).toEqual([]);
    expect(newMentionIds("ask @Brandon Keck, then @Mark Barger", before, people)).toEqual(["mb"]);
  });
  it("a name removed and written again is told again (it is new against the stored text)", () => {
    expect(newMentionIds("@Garry Peters please", "nothing here", people)).toEqual(["gp"]);
  });
});

describe("toldSuffix and mentionBody", () => {
  it("the toast's tail", () => {
    expect(toldSuffix(0)).toBe("");
    expect(toldSuffix(1)).toBe(" — told 1 person");
    expect(toldSuffix(3)).toBe(" — told 3 people");
  });
  it("a long Notes box is cut for the notice body", () => {
    expect(mentionBody("  hi  ")).toBe("hi");
    const long = "x".repeat(MENTION_BODY_MAX + 50);
    const body = mentionBody(long);
    expect(body.length).toBe(MENTION_BODY_MAX);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("sendMentions", () => {
  const ctx = { supabase: {} as never, userId: "bk" };
  const calls: { ids: string[]; msg: Record<string, unknown> }[] = [];
  const deps: MentionDeps = {
    roster: async () => people,
    notify: async (ids, msg) => {
      calls.push({ ids, msg });
      return ids.length;
    },
  };
  it("tells the people named, never the writer, with the place and the link", async () => {
    calls.length = 0;
    const out = await sendMentions(
      ctx,
      {
        text: "Roof is clear @Garry Peters @Brandon Keck",
        writer: "Brandon Keck",
        where: 'opportunity "Courthouse roof"',
        url: "/opportunities?id=o1",
      },
      deps,
    );
    expect(out).toEqual({ mentioned: 1, mention_error: null });
    expect(calls).toEqual([
      {
        ids: ["gp"],
        msg: {
          kind: "mention",
          title: 'Brandon Keck mentioned you on opportunity "Courthouse roof"',
          body: "Roof is clear @Garry Peters @Brandon Keck",
          url: "/opportunities?id=o1",
        },
      },
    ]);
  });
  it("no @ in the text: nothing read, nothing sent", async () => {
    let rosterRead = false;
    const out = await sendMentions(
      ctx,
      { text: "plain note", writer: "x", where: "y", url: "/z" },
      {
        ...deps,
        roster: async () => {
          rosterRead = true;
          return people;
        },
      },
    );
    expect(out).toEqual(NO_MENTIONS);
    expect(rosterRead).toBe(false);
  });
  it("names already in the previous text are left alone", async () => {
    calls.length = 0;
    const out = await sendMentions(
      ctx,
      {
        text: "@Garry Peters @Mark Barger",
        previous: "@Garry Peters",
        writer: "x",
        where: "customer Bell County",
        url: "/customers?id=a1",
      },
      deps,
    );
    expect(out.mentioned).toBe(1);
    expect(calls[0]?.ids).toEqual(["mb"]);
  });
  it("a roster or delivery problem never throws: it comes back as mention_error", async () => {
    const out = await sendMentions(
      ctx,
      { text: "@Garry Peters", writer: "x", where: "y", url: "/z" },
      {
        ...deps,
        notify: async () => {
          throw new Error("push service down");
        },
      },
    );
    expect(out).toEqual({
      mentioned: 0,
      mention_error: "The mentions were not sent: push service down",
    });
    const out2 = await sendMentions(
      ctx,
      { text: "@Garry Peters", writer: "x", where: "y", url: "/z" },
      {
        ...deps,
        roster: async () => {
          throw new Error("no roster");
        },
      },
    );
    expect(out2.mention_error).toBe("The mentions were not sent: no roster");
  });
  it("a mention on an opportunity or a customer has no category: the notice switches never hide it", () => {
    expect(noticeCategory("mention", "/opportunities?id=o1")).toBeNull();
    expect(noticeCategory("mention", "/customers?id=a1")).toBeNull();
    expect(noticeCategory("mention", "/service?id=t1")).toBeNull();
  });
});

describe("the shared box", () => {
  const box = read("src/components/mention-textarea.tsx");
  it("reads the mention roster, lists people on @, picks on Enter / Tab, grows when asked", () => {
    expect(box).toContain("const peopleFn = useServerFn(listMentionPeople);");
    expect(box).toContain('queryKey: ["mention-options"]');
    expect(box).toContain('aria-label="People to mention"');
    expect(box).toContain('if ((e.key === "Enter" || e.key === "Tab") && suggestions[0])');
    expect(box).toContain("const Box = grow ? AutoTextarea : Textarea;");
    expect(box).toContain('export const MENTION_HINT = "type @ to tell someone";');
  });
  it("the ticket note uses it (the inline picker is gone)", () => {
    const t = read("src/components/service/ticket-field-sections.tsx");
    expect(t).toContain("<MentionTextarea");
    expect(t).toContain("onValueChange={setNote}");
    expect(t).not.toContain("useServerFn(listMentionPeople)");
    expect(t).not.toContain("suggestPeople(");
  });
  it("the contact log's note uses it and the toast says who was told", () => {
    const c = read("src/components/crm/contact-log.tsx");
    expect(c).toContain("<MentionTextarea");
    expect(c).toContain("onValueChange={setNote}");
    expect(c).toContain("toast.success(`${logged}${toldSuffix(row.mentioned)}`);");
    expect(c).toContain(
      "if (row.mention_error) toast.error(row.mention_error, { duration: 12_000 });",
    );
    expect(c).toContain("Type @ to tell someone.");
  });
  it("an opportunity's Notes uses it (growing) and the toast says who was told", () => {
    const o = read("src/components/opportunities-page.tsx");
    expect(o).toContain('<MentionTextarea\n            grow\n            id="opp-notes"');
    expect(o).toContain('onValueChange={(v) => set("notes", v)}');
    expect(o).toContain("toast.success(`${saved}${toldSuffix(row.mentioned ?? 0)}`);");
    expect(o).toContain("toast.success(`Opportunity created${toldSuffix(row.mentioned ?? 0)}`);");
    expect(o).toContain(
      "if (row.mention_error) toast.error(row.mention_error, { duration: 12_000 });",
    );
  });
  it("a customer's Notes uses it and the toast says who was told", () => {
    const c = read("src/components/customers-page.tsx");
    expect(c).toContain('<MentionTextarea\n            id="acct-notes"');
    expect(c).toContain('onValueChange={(v) => set("notes", v)}');
    expect(c).toContain("toast.success(`Customer saved${toldSuffix(mentioned)}`);");
    expect(c).toContain("if (mention_error) toast.error(mention_error, { duration: 12_000 });");
  });
});

describe("the servers tell the people named", () => {
  it("logContact: before the hold, with the ticket number or the opportunity's title", () => {
    const s = read("src/lib/contact-log.functions.ts");
    expect(s).toContain('const { sendMentions } = await import("@/lib/mention-notify");');
    expect(s).toContain(
      "const place = await contactPlace(context.supabase, data.kind, data.item_id);",
    );
    expect(s).toContain(
      'where: data ? `Ticket #${data.number} ${data.customer_name}` : "a ticket"',
    );
    expect(s).toContain('where: data ? `opportunity "${data.title}"` : "an opportunity"');
    expect(s).toContain("return { ...row, ...mentions, hold };");
    expect(s).toContain("return { ...row, ...mentions, hold: null };");
    // Mentions go before the hold so a hold problem never loses them.
    expect(s.indexOf("mentions = await sendMentions(")).toBeLessThan(
      s.indexOf("const { holdFollowup } = await import"),
    );
  });
  it("saveOpportunity: Notes against the stored Notes, linking the opportunity", () => {
    const s = read("src/lib/opportunities.functions.ts");
    expect(s).toContain('.select("expected_close, status, notes")');
    expect(s).toContain("oldNotes = cur?.notes ?? null;");
    expect(s).toContain("previous: oldNotes,");
    expect(s).toContain('where: `opportunity "${row.title}"`,');
    expect(s).toContain("url: `/opportunities?id=${row.id}`,");
    expect(s).toContain("mentioned?: number;");
  });
  it("saveAccount: Notes against the stored Notes, linking the customer", () => {
    const s = read("src/lib/crm.functions.ts");
    expect(s).toContain("Promise<AccountRow & MentionOutcome>");
    expect(s).toContain('.select("notes")');
    expect(s).toContain("oldNotes = cur?.notes ?? null;");
    expect(s).toContain("previous: oldNotes,");
    expect(s).toContain("where: `customer ${row.name}`,");
    expect(s).toContain("url: `/customers?id=${row.id}`,");
  });
  it("mention-notify is loaded lazily everywhere (server only), never imported at the top", () => {
    for (const f of [
      "src/lib/contact-log.functions.ts",
      "src/lib/opportunities.functions.ts",
      "src/lib/crm.functions.ts",
    ]) {
      expect(read(f)).not.toMatch(/^import .* from "@\/lib\/mention-notify";/m);
    }
  });
});
