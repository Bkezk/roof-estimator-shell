/**
 * Every email the site sends names the office's inbox as its reply address (owner, Nov 23: "the
 * email that id like to receive responses is Sales@flatroofonline.com").
 *
 * The site sends from an address on jbkbid.com, which has no mailbox. Before this a customer's
 * reply to a Roof Care agreement, a receipt or an invoice bounced, although the Roof Care emails
 * say "Reply to this email".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emailInvoice } from "@/lib/invoices.server";
import { REPLY_TO_DEFAULT, replyToAddress, sendEmail } from "@/lib/notify.server";

type Sent = { from: string; reply_to?: string; to: string[]; subject: string };
let sent: Sent[] = [];
const KEYS = ["RESEND_API_KEY", "NOTIFY_FROM_EMAIL", "NOTIFY_REPLY_TO"] as const;
const before: Record<string, string | undefined> = {};

beforeEach(() => {
  sent = [];
  for (const k of KEYS) before[k] = process.env[k];
  process.env["RESEND_API_KEY"] = "re_made_up_for_the_test";
  process.env["NOTIFY_FROM_EMAIL"] = "Test Roofing <office@example.com>";
  delete process.env["NOTIFY_REPLY_TO"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Sent);
      return { ok: true, text: async () => "" };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

describe("the reply address", () => {
  it("is the office's inbox unless the secret names another", () => {
    expect(REPLY_TO_DEFAULT).toBe("sales@flatroofonline.com");
    expect(replyToAddress()).toBe("sales@flatroofonline.com");
    process.env["NOTIFY_REPLY_TO"] = "  office@example.org ";
    expect(replyToAddress()).toBe("office@example.org");
    process.env["NOTIFY_REPLY_TO"] = "   ";
    expect(replyToAddress()).toBe("sales@flatroofonline.com");
  });

  it("is on a notice, an agreement or a receipt: everything sendEmail sends", async () => {
    const r = await sendEmail({ to: "pat@example.com", subject: "Your plan", text: "Hello" });
    expect(r).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: "Test Roofing <office@example.com>",
      reply_to: "sales@flatroofonline.com",
      to: ["pat@example.com"],
    });
  });

  it("is on an invoice emailed to a customer", async () => {
    const r = await emailInvoice({
      to: ["pat@example.com"],
      subject: "Invoice 7001",
      text: "Attached.",
      pdf: new Uint8Array([37, 80, 68, 70]),
      fileName: "invoice-7001.pdf",
    });
    expect(r).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({ reply_to: "sales@flatroofonline.com" });
  });

  it("follows the secret when it is set", async () => {
    process.env["NOTIFY_REPLY_TO"] = "office@example.org";
    await sendEmail({ to: "pat@example.com", subject: "Your plan", text: "Hello" });
    expect(sent[0]!.reply_to).toBe("office@example.org");
  });
});
