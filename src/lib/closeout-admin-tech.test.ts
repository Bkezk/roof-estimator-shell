/**
 * Owner, Oct 6: an admin (or a manager) who is also ticked Technician pressed Complete on a
 * close-out and landed on the technician's Today page instead of the ticket. The screen routed on
 * `profile?.technician`; the rule it meant ("a technician goes back to their day; the office back
 * to the ticket", Oct 5) is `isOffice`: everyone but a plain technician is the office, an admin or
 * a manager with the Technician tick included (access.ts, the twin of RLS
 * `not is_technician() or is_admin() or is_manager()`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closeoutDestination } from "@/lib/closeout-destination";

const JOB = "11111111-1111-4111-8111-111111111111";
const today = { to: "/service/today" };
const ticket = { to: "/service", search: { id: JOB } };

describe("closeoutDestination", () => {
  it("a plain technician goes back to their day", () => {
    expect(
      closeoutDestination({ role: "user", access: ["service"], technician: true }, JOB),
    ).toEqual(today);
  });
  it("an admin ticked Technician goes back to the ticket", () => {
    expect(closeoutDestination({ role: "admin", access: [], technician: true }, JOB)).toEqual(
      ticket,
    );
  });
  it("a manager (ticked or not) goes back to the ticket", () => {
    expect(closeoutDestination({ role: "manager", access: [], technician: true }, JOB)).toEqual(
      ticket,
    );
    expect(closeoutDestination({ role: "manager", access: [], technician: false }, JOB)).toEqual(
      ticket,
    );
  });
  it("an office user (Service access, not a technician) goes back to the ticket", () => {
    expect(
      closeoutDestination({ role: "user", access: ["service"], technician: false }, JOB),
    ).toEqual(ticket);
  });
  it("no profile yet (never on this screen, but the route must still be one): today", () => {
    expect(closeoutDestination(null, JOB)).toEqual(today);
    expect(closeoutDestination(undefined, JOB)).toEqual(today);
  });
});

describe("the close-out screen routes on isOffice, not the Technician tick", () => {
  const screen = readFileSync("src/components/service/closeout.tsx", "utf8");
  const helper = readFileSync("src/lib/closeout-destination.ts", "utf8");
  it("Complete's onSuccess navigates to closeoutDestination(profile, job.id)", () => {
    expect(screen).toContain("closeoutDestination(profile, job.id)");
    expect(screen).not.toMatch(/if \(profile\?\.technician\) void navigate/);
    expect(screen).not.toMatch(/profile\?\.technician\s*\?/);
  });
  it("the helper is isOffice's", () => {
    expect(helper).toContain("isOffice(");
    expect(helper).not.toMatch(/\.technician/);
  });
});
