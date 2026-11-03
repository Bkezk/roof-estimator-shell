/**
 * The one set of ticket stages (Nov 3, service review item 52; lib/ticket-stages.ts): what the
 * sets hold, the helpers, that the hand-written copies are gone, and that the database's
 * literals still match.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COMPLETE_STAGES } from "@/lib/inspection";
import { DONE_TICKET_STAGES } from "@/lib/owner-view";
import { FINISHED_STAGES as SCHEDULE_FINISHED, LOAD_STAGES } from "@/lib/service-schedule";
import { INVOICE_STAGES, OFFICE_STAGES as RULE_OFFICE, TECH_STAGES } from "@/lib/ticket-stage";
import {
  FINISHED_STAGES,
  isFinishedStage,
  isOfficeStage,
  isWorkStage,
  OFFICE_STAGES,
  WORK_STAGES,
} from "@/lib/ticket-stages";

const read = (p: string) => readFileSync(p, "utf8");

describe("the sets", () => {
  it("open / scheduled / done are the work; authorized / invoiced / closed the office's; done and after is finished", () => {
    expect(WORK_STAGES).toEqual(["open", "scheduled", "done"]);
    expect(OFFICE_STAGES).toEqual(["authorized", "invoiced", "closed"]);
    expect(FINISHED_STAGES).toEqual(["done", "authorized", "invoiced", "closed"]);
  });
  it("the helpers take any string (a row's stage) and say no to null", () => {
    expect(isWorkStage("scheduled")).toBe(true);
    expect(isWorkStage("authorized")).toBe(false);
    expect(isOfficeStage("closed")).toBe(true);
    expect(isOfficeStage("done")).toBe(false);
    expect(isFinishedStage("done")).toBe(true);
    expect(isFinishedStage("open")).toBe(false);
    expect(isFinishedStage(null)).toBe(false);
    expect(isWorkStage(undefined)).toBe(false);
  });
  it("the older names are the same arrays", () => {
    expect(TECH_STAGES).toBe(WORK_STAGES);
    expect(RULE_OFFICE).toBe(OFFICE_STAGES);
    expect(INVOICE_STAGES).toBe(OFFICE_STAGES);
    expect(LOAD_STAGES).toBe(WORK_STAGES);
    expect(SCHEDULE_FINISHED).toBe(FINISHED_STAGES);
    expect(COMPLETE_STAGES).toBe(FINISHED_STAGES);
    expect(DONE_TICKET_STAGES).toBe(FINISHED_STAGES);
  });
});

describe("the copies are gone", () => {
  const files = [
    "src/components/service-page.tsx",
    "src/components/service/closeout.tsx",
    "src/components/service/materials-section.tsx",
    "src/components/service/ticket-work.ts",
    "src/lib/service-inspection.functions.ts",
    "src/lib/service.functions.ts",
    "src/lib/service-field.functions.ts",
    "src/lib/service-crew.ts",
    "src/lib/owner-view.ts",
    "src/lib/inventory.functions.ts",
    "src/lib/inspection.ts",
    "src/lib/service-schedule.ts",
    "src/lib/ticket-stage.ts",
  ];
  it.each(files)("%s writes no stage list of its own", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/\["done",\s*"authorized",\s*"invoiced",\s*"closed"\]/);
    expect(src).not.toMatch(/\["open",\s*"scheduled",\s*"done"\]/);
    expect(src).not.toMatch(/\["authorized",\s*"invoiced",\s*"closed"\]/);
    expect(src).toContain('from "@/lib/ticket-stages"');
  });
});

describe("the database's literals match", () => {
  const sqlList = (set: readonly string[]) => `(${set.map((s) => `'${s}'`).join(", ")})`;
  it("the stage lock (20261006190000) names the office stages and the work stages as the sets do", () => {
    const sql = read("supabase/migrations/20261006190000_stage_backwards_lock.sql");
    expect(sql).toContain(`new.stage in ${sqlList(OFFICE_STAGES)}`);
    expect(sql).toContain(`old.stage in ${sqlList(OFFICE_STAGES)}`);
    expect(sql).toContain(`stage in ${sqlList(WORK_STAGES)}`);
  });
  it("the field edit lock (20261006192000) names the work stages", () => {
    const sql = read("supabase/migrations/20261006192000_field_edit_lock.sql");
    expect(sql).toContain(`j.stage in ${sqlList(WORK_STAGES)}`);
  });
});
