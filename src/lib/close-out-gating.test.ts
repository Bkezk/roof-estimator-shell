/**
 * Close out is offered only to those the server lets finish it (audit, Oct 2). The ticket page
 * used `canCloseOut = canEdit`, so an office user who is not a manager saw Close out and got
 * stuck at the crew question: setJobCrew throws "Only the technician on this ticket or a
 * manager says who is on the job", and ownJob refuses a technician who is not the lead. Now:
 * the lead technician (not once the office has invoiced or closed it, unless they are office)
 * and managers / admins (`managesTickets`). A non-manager office user, a sales / project manager
 * and a crew member who is not the lead see no button.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canCloseOut } from "@/lib/ticket-stage";

const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const tech = { id: LEAD, role: "user", access: ["service"], technician: true };
const crewTech = { ...tech, id: OTHER };
const officeUser = { id: OTHER, role: "user", access: ["service"], technician: false };
const salesPm = { id: OTHER, role: "user", access: ["estimate", "customers"], technician: false };
const manager = { id: OTHER, role: "manager", access: [], technician: false };
const techManager = { ...manager, technician: true };
const admin = { id: OTHER, role: "admin", access: [], technician: false };
const job = (stage: string, technician_id: string | null = LEAD) => ({ technician_id, stage });

describe("canCloseOut: the server's rule (setJobCrew / ownJob)", () => {
  it("an office user who is not a manager: no Close out, at any stage", () => {
    for (const s of ["open", "scheduled", "done", "invoiced", "closed"])
      expect(canCloseOut(officeUser, job(s)), s).toBe(false);
    expect(canCloseOut(salesPm, job("done"))).toBe(false);
  });
  it("managers and admins (a manager ticked Technician too): always", () => {
    for (const p of [manager, techManager, admin])
      for (const s of ["open", "scheduled", "done", "invoiced", "closed"])
        expect(canCloseOut(p, job(s, null)), `${p.role} ${s}`).toBe(true);
  });
  it("the lead technician: Open / Scheduled / Done; not once invoiced or closed", () => {
    expect(canCloseOut(tech, job("open"))).toBe(true);
    expect(canCloseOut(tech, job("scheduled"))).toBe(true);
    expect(canCloseOut(tech, job("done"))).toBe(true);
    expect(canCloseOut(tech, job("invoiced"))).toBe(false);
    expect(canCloseOut(tech, job("closed"))).toBe(false);
  });
  it("an office user who is the ticket's lead may (setJobCrew lets the lead answer)", () => {
    expect(canCloseOut({ ...officeUser, id: LEAD }, job("invoiced"))).toBe(true);
  });
  it("a technician who is not the lead (crew, or someone else's ticket): no", () => {
    expect(canCloseOut(crewTech, job("scheduled"))).toBe(false);
  });
  it("no profile or no ticket yet: no", () => {
    expect(canCloseOut(null, job("done"))).toBe(false);
    expect(canCloseOut(manager, null)).toBe(false);
  });
});

describe("the ticket page uses it for the Close out button", () => {
  const src = readFileSync("src/components/service-page.tsx", "utf8");
  it("the button shows on canCloseOut(profile, job), not on canEdit", () => {
    expect(src).toContain(
      'import { canCloseOut, stageChoices, stageLocked } from "@/lib/ticket-stage";',
    );
    expect(src).toContain("const showCloseOut = canCloseOut(profile, job);");
    expect(src).not.toContain("const canCloseOut = !!job && canEdit;");
    const btn = src.indexOf("<ClipboardCheck");
    const gate = src.lastIndexOf("{showCloseOut && (", btn);
    expect(gate).toBeGreaterThan(0);
    expect(btn - gate).toBeLessThan(200);
  });
});
