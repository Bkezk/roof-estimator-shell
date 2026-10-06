/**
 * @mentions in ticket notes (service study M3, owner Oct 5). Since Oct 6 (owner) the roster is
 * everyone with Service or Customers access (mention_options), not the dispatch roster
 * (technician_options), which lists only who can be assigned a ticket.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canBeMentioned } from "@/lib/dispatch-access";
import { insertMention, mentionedIds, mentionQuery, suggestPeople } from "@/lib/mentions";

const people = [
  { id: "bk", name: "Brandon Keck" },
  { id: "gp", name: "Garry Peters" },
  { id: "rs", name: "RoAnna Sims" },
  { id: "mb", name: "Mark Barger" },
  { id: "m", name: "Mark" },
  { id: "tf", name: "Trace Floyd" },
];

describe("typing", () => {
  it("an @ at the start or after a space opens the list; an email address does not", () => {
    expect(mentionQuery("@", 1)).toEqual({ at: 0, query: "" });
    expect(mentionQuery("Still leaking @Bra", 18)).toEqual({ at: 14, query: "Bra" });
    expect(mentionQuery("mail jbk@flatroofonline.com", 27)).toBeNull();
    expect(mentionQuery("no mention here", 15)).toBeNull();
  });
  it("closes on a new line or a long run", () => {
    expect(mentionQuery("@Bra\nnext", 9)).toBeNull();
    expect(mentionQuery("@one two three four", 19)).toBeNull();
  });
  it("suggests by first or last name, A–Z, at most 6", () => {
    expect(suggestPeople(people, "ke").map((p) => p.id)).toEqual(["bk"]);
    expect(suggestPeople(people, "mar").map((p) => p.id)).toEqual(["m", "mb"]);
    expect(suggestPeople(people, "")).toHaveLength(6);
  });
  it("picking writes '@Full Name ' and moves the caret past it", () => {
    expect(insertMention("Still leaking @Bra", 14, 18, "Brandon Keck")).toEqual({
      text: "Still leaking @Brandon Keck ",
      caret: 28,
    });
  });
});

describe("who a saved note mentions", () => {
  it("everyone named after an @, once each, in order, any case", () => {
    expect(
      mentionedIds(
        "Notes just say HVAC issues maybe we should have Mark go look @brandon keck @Garry Peters @Brandon Keck",
        people,
      ),
    ).toEqual(["bk", "gp"]);
  });
  it("the longer name wins: '@Mark Barger' is not '@Mark'; '@Mark' alone is Mark", () => {
    expect(mentionedIds("ask @Mark Barger", people)).toEqual(["mb"]);
    expect(mentionedIds("ask @Mark, then @Trace Floyd.", people)).toEqual(["m", "tf"]);
  });
  it("a name must stand alone: '@Marks' and 'x@Mark' are no one", () => {
    expect(mentionedIds("@Marks truck", people)).toEqual([]);
    expect(mentionedIds("x@Mark", people)).toEqual([]);
  });
});

describe("saving the note", () => {
  const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
  const body = fns.slice(
    fns.indexOf("export const addJobNote"),
    fns.indexOf("export const recentRepairsForJob"),
  );
  it("notifies the people named, never the writer, with a link to the ticket", () => {
    expect(body).toContain("mentionedIds(data.note, people).filter((id) => id !== context.userId)");
    expect(body).toContain('kind: "mention"');
    expect(body).toContain("mentioned you on Ticket #${job.number}");
    expect(body).toContain("url: `/service?id=${job.id}`");
  });
  it("a delivery problem is loud and says the note itself was added", () => {
    expect(body).toContain("Note added, but the mentions were not sent:");
  });
});

describe("the note box", () => {
  const src = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");
  it("suggests people on @ and says who was told", () => {
    expect(src).toContain('aria-label="People to mention"');
    expect(src).toContain("type @ to tell someone");
    expect(src).toContain("Note added — told");
  });
});

// ---- who can be mentioned (owner, Oct 6) ------------------------------------------------------

describe("the roster: anyone with Service or Customers access", () => {
  it("canBeMentioned: admins, managers, and users with Service or Customers access", () => {
    expect(canBeMentioned({ role: "admin", access: [] })).toBe(true);
    expect(canBeMentioned({ role: "manager", access: [] })).toBe(true);
    expect(canBeMentioned({ role: "user", access: ["service"], technician: true })).toBe(true);
    expect(canBeMentioned({ role: "user", access: ["customers"] })).toBe(true);
    // An estimator or an inventory-only login is not on a ticket's side of the house.
    expect(canBeMentioned({ role: "user", access: ["estimate", "inventory"] })).toBe(false);
    expect(canBeMentioned({ role: "user", access: [] })).toBe(false);
    expect(canBeMentioned(null)).toBe(false);
  });
  it("the picker and the server read the same roster (mention_options), not the dispatch one", () => {
    const box = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");
    expect(box).toContain("const peopleFn = useServerFn(listMentionPeople);");
    expect(box).toContain('queryKey: ["mention-options"]');
    expect(box).not.toContain("const peopleFn = useServerFn(listTechnicians);");
    const auth = readFileSync("src/lib/auth.functions.ts", "utf8");
    expect(auth).toContain("export const listMentionPeople = createServerFn");
    expect(auth).toContain('rpc("mention_options")');
    const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
    const body = fns.slice(
      fns.indexOf("export const addJobNote"),
      fns.indexOf("export const recentRepairsForJob"),
    );
    expect(body).toContain("people = await mentionRoster(context.supabase);");
    expect(body).not.toContain('rpc("technician_options")');
  });
  it("migration 20261006193000_mention_options.sql: SECURITY DEFINER, the rule in SQL, authenticated only", () => {
    const path = "supabase/migrations/20261006193000_mention_options.sql";
    const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
    expect(raw.startsWith("-- ")).toBe(true);
    expect(raw.slice(0, 500)).toContain("(owner, Oct 6)");
    const sql = raw
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    expect(sql).toContain(
      "create or replace function public.mention_options() returns table (id uuid, full_name text, email text) language sql stable security definer set search_path = public as $$",
    );
    expect(sql).toContain("where (public.has_access('service') or public.has_access('customers'))");
    expect(sql).toContain(
      "and (p.role in ('admin', 'manager') or 'service' = any(p.access) or 'customers' = any(p.access))",
    );
    expect(sql).toContain("order by coalesce(nullif(trim(p.full_name), ''), p.email);");
    expect(sql).toContain("revoke all on function public.mention_options() from public;");
    expect(sql).toContain("revoke all on function public.mention_options() from anon;");
    expect(sql).toContain("grant execute on function public.mention_options() to authenticated;");
  });
});
