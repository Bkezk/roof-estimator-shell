/**
 * The Tech Board reads its own week (owner, Oct 14: "any assigned tickets show up and all
 * statuses show on the board as it progresses; once assigned a day and tech it should really
 * stay on the board regardless of step or time"). The board drew from listServiceJobs — the
 * 1,000 most recently updated tickets — so an assigned ticket fell off its cell once a thousand
 * others had been touched since; after the CenterPoint ticket import that is most weeks.
 * listBoardJobs reads every assigned ticket in the week at any stage plus the Unassigned rail.
 * Fails on the old code: no listBoardJobs, and the board keyed on the shared list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { listBoardJobs } from "@/lib/service.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const OFFICE = "00000000-0000-4000-8000-00000000000a";
const TECH = "00000000-0000-4000-8000-00000000000b";
const job = (id: string, extra: Row): Row => ({
  id,
  number: Number(id.slice(-3)),
  customer_name: "Bell County",
  site_id: null,
  stage: "open",
  technician_id: null,
  scheduled_date: null,
  deleted_at: null,
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:00:00Z",
  ...extra,
});

describe("listBoardJobs: the week's assigned tickets at any stage, plus the Unassigned rail", () => {
  const env = fakeSupabase({
    profiles: [{ id: OFFICE, role: "user", access: ["service"], technician: false }],
    service_jobs: [
      job("j101", { stage: "closed", technician_id: TECH, scheduled_date: "2026-10-14" }),
      job("j102", { stage: "invoiced", technician_id: TECH, scheduled_date: "2026-10-12" }),
      job("j103", { stage: "open", technician_id: TECH, scheduled_date: "2026-10-18" }),
      job("j104", { stage: "scheduled", technician_id: TECH, scheduled_date: "2026-10-19" }),
      job("j105", { stage: "scheduled", technician_id: TECH, scheduled_date: "2026-10-11" }),
      job("j106", { stage: "open" }),
      job("j107", { stage: "scheduled", technician_id: TECH }),
      job("j108", { stage: "closed" }),
      job("j109", {
        stage: "open",
        technician_id: TECH,
        scheduled_date: "2026-10-14",
        deleted_at: "2026-10-13T00:00:00Z",
      }),
    ],
  });
  const call = (from: string, to: string) =>
    (listBoardJobs as unknown as (a: { data: Row; context: unknown }) => Promise<Row[]>)({
      data: { from, to },
      context: { supabase: env.db, userId: OFFICE },
    });
  it("Mon Oct 12 – Sun Oct 18: the four assigned that week (Closed and Invoiced included) and the rail", async () => {
    const rows = await call("2026-10-12", "2026-10-18");
    expect(rows.map((r) => r["id"]).sort()).toEqual(["j101", "j102", "j103", "j106", "j107"]);
  });
  it("another week: its own assigned tickets, the rail the same; a deleted or done unassigned ticket never", async () => {
    const rows = await call("2026-10-19", "2026-10-25");
    expect(rows.map((r) => r["id"]).sort()).toEqual(["j104", "j106", "j107"]);
  });
  it("someone without Service or Customers access is refused", async () => {
    const other = fakeSupabase({
      profiles: [{ id: OFFICE, role: "user", access: ["estimate"], technician: false }],
      service_jobs: [],
    });
    await expect(
      (listBoardJobs as unknown as (a: { data: Row; context: unknown }) => Promise<Row[]>)({
        data: { from: "2026-10-12", to: "2026-10-18" },
        context: { supabase: other.db, userId: OFFICE },
      }),
    ).rejects.toThrow("Service access required");
  });
});

describe("the board draws from listBoardJobs, keyed by its week", () => {
  const board = readFileSync("src/components/service/board-page.tsx", "utf8");
  it("the week's read, its key under service-jobs, the optimistic move on that key", () => {
    expect(board).toContain("const listFn = useServerFn(listBoardJobs);");
    expect(board).not.toContain("listServiceJobs");
    expect(board).toContain(
      'const boardKey = ["service-jobs", "board", days[0]!, days[6]!] as const;',
    );
    expect(board).toContain("queryFn: () => listFn({ data: { from: days[0]!, to: days[6]! } }),");
    expect(board).toContain("await qc.cancelQueries({ queryKey: boardKey });");
    expect(board).toContain("if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev);");
    expect(board).not.toContain('qc.setQueryData<ServiceJobWithTech[]>(["service-jobs"]');
    // A cell shows every ticket on that tech and day, whatever its stage.
    expect(board).toContain(
      ".filter((j) => j.technician_id === techId && j.scheduled_date === ymd)",
    );
  });
  it("the server read: assigned in the week at any stage, the rail Open / Scheduled only", () => {
    const fns = readFileSync("src/lib/service.functions.ts", "utf8");
    const body = fns.slice(
      fns.indexOf("export const listBoardJobs"),
      fns.indexOf("export interface AwaitingInvoice"),
    );
    expect(body).toContain('.not("technician_id", "is", null)');
    expect(body).toContain('.gte("scheduled_date", data.from)');
    expect(body).toContain('.lte("scheduled_date", data.to)');
    expect(body).toContain('.in("stage", ["open", "scheduled"])');
    expect(body).toContain('.or("technician_id.is.null,scheduled_date.is.null")');
    expect(body).not.toContain('.eq("stage"');
  });
});
