/**
 * The QR pages show the server's own reason (owner, Nov 24: "yes on 5").
 *
 * When the server turned a form down, the two public pages showed one general line whatever
 * the reason was. They now show the reason, when it is one of the plain sentences written for
 * a visitor. Every test here fails on the code of that morning: there was no such list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_BUSY,
  PUBLIC_CHECK_FORM,
  PUBLIC_NEED_WHAT,
  PUBLIC_NOT_READY,
  PUBLIC_PRICE_BUTTON,
  PUBLIC_REFUSAL_LINES,
  PUBLIC_TERMS_MOVED,
  PUBLIC_TRY_AGAIN,
  publicRefusalLine,
  publicSayLine,
} from "@/lib/public-forms";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

/**
 * The sentences one database function raises for a visitor: the ones under the two codes the
 * server passes on (public-forms.functions.ts plainRefusal), as the visitor would read them.
 */
function visitorSentences(sql: string, fn: string): string[] {
  const from = sql.indexOf(`create or replace function public.${fn}(`);
  expect(from, fn).toBeGreaterThan(-1);
  const next = sql.indexOf("create or replace function public.", from + 10);
  const body = sql.slice(from, next === -1 ? undefined : next);
  return [
    ...body.matchAll(/raise exception '((?:[^']|'')*)'\s*using errcode = '(22023|P0001)'/g),
  ].map((m) => m[1]!.replace(/''/g, "'"));
}

// The file that last wrote the two public functions.
const SQL = flat("supabase/migrations/20261124600000_public_pages_audit_fixes.sql");
const fromDatabase = [
  ...visitorSentences(SQL, "public_care_quote"),
  ...visitorSentences(SQL, "public_request_submit"),
];

describe("the list of reasons a visitor is shown", () => {
  it("holds every sentence the database's two public functions raise for a visitor", () => {
    expect(fromDatabase.length).toBeGreaterThan(20);
    for (const sentence of fromDatabase) expect(PUBLIC_REFUSAL_LINES, sentence).toContain(sentence);
  });
  it("holds nothing else but the server's own three", () => {
    const known = new Set([
      ...fromDatabase,
      PUBLIC_TERMS_MOVED,
      PUBLIC_NOT_READY,
      PUBLIC_CHECK_FORM,
    ]);
    for (const line of PUBLIC_REFUSAL_LINES) expect(known.has(line), line).toBe(true);
    expect(new Set(PUBLIC_REFUSAL_LINES).size).toBe(PUBLIC_REFUSAL_LINES.length);
  });
  it("is the latest writing of the two functions: no later file writes them again", () => {
    const later = ["20261124900000_public_limits_and_email_count.sql"];
    for (const f of later) {
      const sql = flat(`supabase/migrations/${f}`);
      expect(sql).not.toContain("create or replace function public.public_care_quote(");
      expect(sql).not.toContain("create or replace function public.public_request_submit(");
    }
  });
  it("the sentences the server itself says before the database is asked are on it too", () => {
    const fns = read("src/lib/public-forms.functions.ts");
    const thrown = [
      ...new Set([...fns.matchAll(/throw new Error\((PUBLIC_[A-Z_]+)\)/g)].map((m) => m[1])),
    ];
    // PUBLIC_TRY_AGAIN is a fault of ours: the page's general line says the same, with the number.
    expect(thrown.sort()).toEqual([
      "PUBLIC_EMAIL_WRONG",
      "PUBLIC_NEED_CONTACT",
      "PUBLIC_NEED_WHAT",
      "PUBLIC_NOT_READY",
      "PUBLIC_TERMS_MOVED",
      "PUBLIC_TRY_AGAIN",
    ]);
    // The two written in that file, read from its text (loading it loads the server's modules).
    const written = (name: string) =>
      new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(fns)?.[1] ?? `${name} not found`;
    for (const said of [
      written("PUBLIC_EMAIL_WRONG"),
      written("PUBLIC_NEED_CONTACT"),
      PUBLIC_NEED_WHAT,
      PUBLIC_CHECK_FORM,
    ])
      expect(publicRefusalLine(said), said).toBe(said);
    expect(fns).toContain("custom && first ? first.message : PUBLIC_CHECK_FORM");
  });
  it("every sentence is plain: no table, no code, no price", () => {
    for (const line of PUBLIC_REFUSAL_LINES) {
      expect(line).not.toMatch(/public\.|_|\$|sql|null|uuid|violat|constraint/i);
      expect(line.endsWith(".")).toBe(true);
    }
  });
});

describe("what the page says", () => {
  it("the reason, out of the words a failure arrives in", () => {
    expect(publicRefusalLine("Type the state as two letters, like KY.")).toBe(
      "Type the state as two letters, like KY.",
    );
    expect(
      publicRefusalLine('Error: {"message":"Tick a service, or tell us what is going on."}'),
    ).toBe("Tick a service, or tell us what is going on.");
    expect(publicRefusalLine(PUBLIC_TERMS_MOVED)).toBe(PUBLIC_TERMS_MOVED);
    expect(publicRefusalLine(PUBLIC_NOT_READY)).toBe(PUBLIC_NOT_READY);
  });
  it("the price sentences name the button as the page spells it", () => {
    expect(PUBLIC_PRICE_BUTTON).toBe("Show my price");
    // The button itself, and the page's own line about it.
    const page = flat("src/components/public/care-page.tsx");
    expect(page).toContain("Show my price </PublicButton>");
    expect(page).toContain("Press Show my price again.");
    for (const said of [
      "The prices on the page are no longer current. Press Show my prices again, then send.",
      "The address changed after the prices were shown. Press Show my prices again, then send.",
      "The price changed after it was shown. Press Show my prices again, then send.",
    ]) {
      const shown = publicRefusalLine(said)!;
      expect(shown).toContain("Press Show my price again, then send.");
      expect(shown).not.toContain("Show my prices");
    }
    expect(
      publicRefusalLine(
        "The price changed after it was shown. Press Show my prices again, then send.",
      ),
    ).toBe("The price changed after it was shown. Press Show my price again, then send.");
  });
  it("nothing for a fault of ours or a database's own words: the page keeps its general line", () => {
    for (const words of [
      PUBLIC_TRY_AGAIN,
      "permission denied for function public_request_submit",
      'null value in column "account_id" of relation "crm_opportunities" violates not-null constraint',
      "Failed to fetch",
      "Only the site's own server sends a public request",
      "",
    ])
      expect(publicRefusalLine(words), words).toBeNull();
  });
  it("a limit still wins, and both come through one door", () => {
    expect(publicSayLine(PUBLIC_BUSY)).toBe(PUBLIC_BUSY);
    expect(publicSayLine("Type your name.")).toBe("Type your name.");
    expect(publicSayLine("Failed to fetch")).toBeNull();
  });
});

describe("both pages use it at every send", () => {
  it("the Roof Care page: the price question and the sign-up", () => {
    const page = flat("src/components/public/care-page.tsx");
    expect(page).toContain("setAskError(publicSayLine(errWords(e)) ?? SEND_FAILED_LINE);");
    expect(page).toContain("setSendError(publicSayLine(errWords(e)) ?? SEND_FAILED_LINE);");
    expect(page).not.toContain("publicLimitLine(");
  });
  it("the Request service page", () => {
    const page = flat("src/components/public/request-page.tsx");
    expect(page).toContain("setSendError(publicSayLine(errWords(e)) ?? SEND_FAILED_LINE);");
    expect(page).not.toContain("publicLimitLine(");
  });
  it("the server passes on the database's sentence under the two codes, and nothing else", () => {
    const fns = flat("src/lib/public-forms.functions.ts");
    // Nov 26, 2026: the two codes have a name now (visitorCanFix), because a request refused
    // under them is also given back to the visitor's count.
    expect(fns).toContain("if (visitorCanFix(error)) return new Error(error.message);");
    expect(fns).toContain(
      'export const visitorCanFix = (error: { code?: string }): boolean => error.code === "22023" || error.code === "P0001";',
    );
    expect(fns).toContain("return new Error(PUBLIC_TRY_AGAIN);");
  });
});
