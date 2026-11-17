/**
 * Invoices on a trade bid, the database change (20261117090000_trade_bid_invoices.sql), pinned
 * as text. What it does was proven on the live database in runs that were rolled back
 * (docs/qa/trade-bids-2026-11-16.md); this keeps the file from drifting from what was applied.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
// Comments cannot satisfy a pin.
const sql = read("../../supabase/migrations/20261117090000_trade_bid_invoices.sql")
  .replace(/--[^\n]*/g, "")
  .replace(/\s+/g, " ");
const types = read("../integrations/supabase/types.ts").replace(/\s+/g, " ");

describe("an invoice's parent is a ticket or a trade bid", () => {
  it("the ticket may be blank, and exactly one of the two is set", () => {
    expect(sql).toContain("alter table public.invoices alter column service_job_id drop not null;");
    expect(sql).toContain(
      "add constraint invoices_one_parent check ((service_job_id is not null) <> (bid_id is not null));",
    );
  });
  it("a bid's voided invoices go with the bid when it is removed for good", () => {
    // restrict would leave a deleted bid with a voided invoice impossible to purge, and the
    // purge of old deleted bids removes them all in one statement.
    expect(sql).toContain(
      "add constraint invoices_bid_id_fkey foreign key (bid_id) references public.bids(id) on delete cascade;",
    );
    expect(sql).not.toContain("on delete restrict");
  });
});

describe("the trade job number", () => {
  it("comes from a series that starts at 1001 and nobody reads directly", () => {
    expect(sql).toContain(
      "create sequence if not exists public.trade_bid_number_seq as integer start with 1001;",
    );
    expect(sql).toContain(
      "revoke all on sequence public.trade_bid_number_seq from public, anon, authenticated;",
    );
  });
  it("is one per bid, and only a trade bid has one", () => {
    expect(sql).toContain(
      "create unique index if not exists bids_trade_number_key on public.bids (trade_number) where trade_number is not null;",
    );
    expect(sql).toContain(
      "add constraint bids_trade_number_kind check (trade_number is null or kind = 'trade');",
    );
  });
  it("is handed out to someone who may invoice, for a won trade bid, once", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.trade_bid_number(p_bid uuid)"),
      sql.indexOf("revoke all on function public.trade_bid_number(uuid)"),
    );
    expect(fn).toContain("security definer");
    expect(fn).toContain(
      "if not (public.is_admin() or public.is_manager() or public.is_sales_pm()) then",
    );
    expect(fn).toContain("if v_bid.kind <> 'trade' then");
    expect(fn).toContain("if v_bid.status <> 'won' then");
    // The same number every time after the first.
    expect(fn).toContain("if v_bid.trade_number is null then");
    expect(fn).toContain("set trade_number = nextval('public.trade_bid_number_seq')");
    // The words people see.
    expect(fn).toContain("Mark the bid Won before invoicing it");
    expect(fn).toContain("Only a trade bid is invoiced from the bid");
  });
  it("cannot be called by a visitor who is not signed in", () => {
    expect(sql).toContain(
      "revoke all on function public.trade_bid_number(uuid) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.trade_bid_number(uuid) to authenticated;",
    );
  });
});

describe("a bid with a live invoice stays", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.bids_invoiced_guard()"),
    sql.indexOf("drop trigger if exists bids_invoiced_guard"),
  );
  it("deleting it and removing it for good are both refused, in plain words", () => {
    expect(sql).toContain(
      "create trigger bids_invoiced_guard before delete or update of deleted_at on public.bids for each row execute function public.bids_invoiced_guard();",
    );
    expect(fn).toContain("where i.bid_id = old.id and i.status <> 'void';");
    expect(fn).toContain("This bid has an invoice (%). Void the invoice before deleting the bid.");
  });
  it("does not depend on what the person deleting may see", () => {
    // An estimator deletes bids and cannot read invoices.
    expect(fn).toContain("security definer");
  });
  it("only a move into the bin is checked: restoring a bid and other changes pass", () => {
    expect(fn).toContain(
      "if tg_op = 'UPDATE' and not (old.deleted_at is null and new.deleted_at is not null) then return new; end if;",
    );
  });
});

describe("the types the code is checked against", () => {
  it("know the new columns and the function", () => {
    expect(types).toContain("service_job_id: string | null");
    expect(types).toContain("bid_id: string | null");
    expect(types).toContain('foreignKeyName: "invoices_bid_id_fkey"');
    expect(types).toContain("trade_number: number | null");
    expect(types).toContain("trade_bid_number: { Args: { p_bid: string }; Returns: number }");
  });
});
