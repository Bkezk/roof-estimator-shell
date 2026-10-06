/**
 * QA audit bug 6 (owner, Oct 6): with service_settings.authorizer_id null, ticket_authorizers()
 * returned every admin in no order and afterTicketStage handed the "Authorize ticket #…"
 * follow-up to the first id, so with two admins it flipped between them on any save. Decision:
 * the authorizer defaults to Brandon (Brandon@flatroofonline.com — not added as a user yet),
 * then every admin in a stable order. These pin the constant, the picker's help text and the
 * migration text (20261006210000_default_authorizer.sql).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  authorizerFallbackLabel,
  DEFAULT_AUTHORIZER_EMAIL,
  isDefaultAuthorizerEmail,
} from "./default-authorizer";

const DIR = "supabase/migrations";
const FILE = "20261006210000_default_authorizer.sql";
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("the default authorizer", () => {
  it("is Brandon, Brandon@flatroofonline.com, compared without regard to case", () => {
    expect(DEFAULT_AUTHORIZER_EMAIL).toBe("brandon@flatroofonline.com");
    expect(isDefaultAuthorizerEmail("Brandon@flatroofonline.com")).toBe(true);
    expect(isDefaultAuthorizerEmail("  BRANDON@FLATROOFONLINE.COM ")).toBe(true);
    expect(isDefaultAuthorizerEmail("brandon@example.com")).toBe(false);
    expect(isDefaultAuthorizerEmail(null)).toBe(false);
    expect(isDefaultAuthorizerEmail(undefined)).toBe(false);
  });
});

describe("the Setup › Service rates picker's help text", () => {
  const roanna = { id: "r", name: "RoAnna Sims", email: "roanna@flatroofonline.com" };
  it("nothing picked, Brandon not a user yet: says so, and that every admin gets it until then", () => {
    expect(authorizerFallbackLabel({ authorizer_id: null }, [roanna])).toBe(
      "Default: Brandon (Brandon@flatroofonline.com) — not added as a user yet; until then every admin",
    );
    expect(authorizerFallbackLabel({ authorizer_id: "" }, [])).toBe(
      "Default: Brandon (Brandon@flatroofonline.com) — not added as a user yet; until then every admin",
    );
  });
  it("nothing picked, Brandon among the admins / managers: names him", () => {
    const brandon = { id: "b", name: "Brandon Keck", email: "Brandon@FlatRoofOnline.com" };
    expect(authorizerFallbackLabel({ authorizer_id: null }, [roanna, brandon])).toBe(
      "Default: Brandon Keck",
    );
  });
  it("someone picked: no fallback text", () => {
    expect(authorizerFallbackLabel({ authorizer_id: "r" }, [roanna])).toBeNull();
  });
  it("the picker shows it under the select when nothing is picked; the email is a display constant", () => {
    const ui = read("src/components/service-rates-settings.tsx");
    expect(ui).toContain('from "@/lib/default-authorizer"');
    expect(ui).toContain("authorizerFallbackLabel(");
    expect(ui).not.toContain("flatroofonline");
  });
});

describe("the migration", () => {
  const raw = read(`${DIR}/${FILE}`);
  const sql = flat(raw);
  it("exists, is the last word on ticket_authorizers(), and lower-cases the email", () => {
    expect(raw).not.toBe("");
    const defs = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(`${DIR}/${f}`, "utf8").includes(
          "create or replace function public.ticket_authorizers(",
        ),
      );
    expect(defs.at(-1)).toBe(FILE);
    expect(sql).toContain("lower(p.email) = 'brandon@flatroofonline.com'");
    expect(sql).toContain("lower(new.email) = 'brandon@flatroofonline.com'");
    expect(raw).not.toMatch(/= 'Brandon@/);
  });
  it("falls back settings → Brandon → every admin, each only when the one before names nobody", () => {
    const body = sql.slice(
      sql.indexOf("create or replace function public.ticket_authorizers()"),
      sql.indexOf("$$;", sql.indexOf("create or replace function public.ticket_authorizers()")),
    );
    const chosen = body.indexOf("where s.id = 1 and p.role in ('admin', 'manager')");
    const brandon = body.indexOf("where lower(p.email) = 'brandon@flatroofonline.com'");
    const admins = body.indexOf("where p.role = 'admin'");
    expect(chosen).toBeGreaterThan(0);
    expect(brandon).toBeGreaterThan(chosen);
    expect(admins).toBeGreaterThan(brandon);
    expect(body).toContain(
      "where lower(p.email) = 'brandon@flatroofonline.com' and p.role in ('admin', 'manager') and not exists (select 1 from chosen)",
    );
    expect(body).toContain(
      "where p.role = 'admin' and not exists (select 1 from chosen) and not exists (select 1 from fallback)",
    );
    expect(body).toContain("order by created_at, id");
    expect(body).toContain("security definer set search_path = public");
  });
  it("keeps the grants: not public or anon; authenticated and service_role", () => {
    expect(sql).toContain("revoke all on function public.ticket_authorizers() from public, anon;");
    expect(sql).toContain(
      "grant execute on function public.ticket_authorizers() to authenticated, service_role;",
    );
  });
  it("a trigger on profiles sets Brandon as the authorizer once he is an admin or manager and nothing is set", () => {
    expect(sql).toContain("create or replace function public.default_authorizer_on_profile()");
    expect(sql).toContain("returns trigger language plpgsql security definer");
    expect(sql).toContain(
      "if lower(new.email) = 'brandon@flatroofonline.com' and new.role in ('admin', 'manager') then",
    );
    expect(sql).toContain(
      "update public.service_settings set authorizer_id = new.id where id = 1 and authorizer_id is null;",
    );
    expect(sql).toContain("drop trigger if exists profiles_default_authorizer on public.profiles;");
    expect(sql).toContain(
      "create trigger profiles_default_authorizer after insert or update of role, email on public.profiles for each row execute function public.default_authorizer_on_profile();",
    );
  });
  it("backfills once if he is already there, and is idempotent", () => {
    expect(sql).toContain("update public.service_settings s set authorizer_id = p.id");
    expect(sql).toContain("where s.id = 1 and s.authorizer_id is null");
    expect(raw).not.toMatch(/create function|create table|add column (?!if not exists)/i);
  });
});
