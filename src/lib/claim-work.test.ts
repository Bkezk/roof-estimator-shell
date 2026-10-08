/**
 * Owner, Oct 8: "can office keep full visibility even when ticked technician. basically they
 * should be able to go in and claim it if need be" and "on the calendar view on work overview
 * can we have the unassigned list on the left of the calendar so people can drag and drop it
 * onto their own calendar?". Technician-only (`isFieldOnly`) is what narrows a view now, not the
 * tick; `canClaim` is who takes unassigned work; the two claim server functions, the ticket
 * page's Claim button and the calendar's unassigned pane with drag-and-drop are pinned here.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLAIM_NEEDS_TICK,
  CLAIM_TAKEN,
  OFFICE_PAGES,
  canClaim,
  isFieldOnly,
  isOffice,
  shapeForKind,
} from "@/lib/access";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const src = (p: string) => read(p).replace(/\s+/g, " ");

const techOnly = shapeForKind("technician", true);
const officeTech = shapeForKind("office", true);
const office = shapeForKind("office", false);
const managerTech = shapeForKind("manager", true);
const ownerTech = shapeForKind("owner", true);

describe("technician-only vs ticked Technician", () => {
  it("a technician (Service + Inventory, ticked) is technician-only; office / manager / owner ticked are not", () => {
    expect(isFieldOnly(techOnly)).toBe(true);
    expect(isFieldOnly({ role: "user", access: ["service", "inventory"], technician: true })).toBe(
      true,
    );
    expect(isFieldOnly({ role: "user", access: [], technician: true })).toBe(true);
    expect(isFieldOnly(officeTech)).toBe(false);
    expect(isFieldOnly(managerTech)).toBe(false);
    expect(isFieldOnly(ownerTech)).toBe(false);
    expect(isFieldOnly(office)).toBe(false);
    expect(isFieldOnly({ role: "user", access: ["service"], technician: false })).toBe(false);
    expect(isFieldOnly(null)).toBe(false);
  });
  it("so an office person ticked Technician keeps full visibility (isOffice), and a technician does not", () => {
    expect(isOffice(officeTech)).toBe(true);
    expect(isOffice(office)).toBe(true);
    expect(isOffice(managerTech)).toBe(true);
    expect(isOffice(techOnly)).toBe(false);
    expect(isOffice(null)).toBe(false);
  });
  it("the old per-page rows: a technician with Estimate is not technician-only (they read as office)", () => {
    expect(isFieldOnly({ role: "user", access: ["estimate", "inventory"], technician: true })).toBe(
      false,
    );
  });
});

describe("who claims unassigned work", () => {
  it("anyone ticked Technician who sees every ticket and has Service: office, manager, owner on the board", () => {
    expect(canClaim(officeTech)).toBe(true);
    expect(canClaim(managerTech)).toBe(true);
    expect(canClaim(ownerTech)).toBe(true);
  });
  it("not an office person without the tick, not a technician-only user, not someone without Service", () => {
    expect(canClaim(office)).toBe(false);
    expect(canClaim(techOnly)).toBe(false);
    expect(
      canClaim({
        role: "user",
        access: OFFICE_PAGES.filter((p) => p !== "service"),
        technician: true,
      }),
    ).toBe(false);
    expect(canClaim(null)).toBe(false);
  });
  it("the messages", () => {
    expect(CLAIM_NEEDS_TICK).toBe("Claiming is for people ticked Technician who see every ticket");
    expect(CLAIM_TAKEN).toBe("Someone already has it");
  });
});

describe("the migration", () => {
  const sql = flat(
    read("supabase/migrations/20261008190000_office_technician_keeps_visibility.sql"),
  );
  it("is_technician() = ticked, role user, no page beyond Service and Inventory — the twin of isFieldOnly", () => {
    expect(sql).toContain(
      "create or replace function public.is_technician() returns boolean language sql stable security definer set search_path = public as $$ select exists ( select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.technician, false) and p.role = 'user' and not (p.access && array['estimate', 'pricing', 'customers', 'invoices', 'prospect', 'takeoff']::text[]) ); $$;",
    );
    // No policy is rewritten and nothing new is granted: every rule reads the function.
    expect(sql).not.toMatch(/create policy|grant |alter table/);
  });
});

describe("the claim server functions", () => {
  it("claimServiceJob: canClaim, no technician yet, open or scheduled, the dropped day as its date, the dispatch after-effects", () => {
    const fn = src("src/lib/service.functions.ts");
    const body = fn.slice(
      fn.indexOf("export const claimServiceJob"),
      fn.indexOf("export const deleteServiceJob"),
    );
    expect(body).toContain("if (!canClaim(p)) throw new Error(CLAIM_NEEDS_TICK);");
    expect(body).toContain("if (cur.technician_id) throw new Error(CLAIM_TAKEN);");
    expect(body).toContain('if (cur.stage !== "open" && cur.stage !== "scheduled")');
    expect(body).toContain("const scheduled_date = data.date ?? cur.scheduled_date;");
    expect(body).toContain('stage: scheduled_date ? "scheduled" : "open",');
    expect(body).toContain('.is("technician_id", null)');
    expect(body).toContain("if (!row) throw new Error(CLAIM_TAKEN);");
    expect(body).toContain("await syncCrewLead(sb, row.id, row.technician_id);");
    expect(body).toContain(
      "await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, sb, cur.stage);",
    );
    expect(body).not.toContain("managesTickets");
  });
  it("claimOpportunity: canClaim, no assignee yet, open, the dropped day as its expected close", () => {
    const fn = src("src/lib/opportunities.functions.ts");
    const body = fn.slice(fn.indexOf("export const claimOpportunity"));
    expect(body).toContain("if (!canClaim(p)) throw new Error(CLAIM_NEEDS_TICK);");
    expect(body).toContain("if (cur.assignee_id) throw new Error(CLAIM_TAKEN);");
    expect(body).toContain("if (!(OPEN_OPP_STATUSES as readonly string[]).includes(cur.status))");
    expect(body).toContain("...(data.date ? { expected_close: data.date } : {}),");
    expect(body).toContain('.is("assignee_id", null)');
  });
});

describe("where it is used", () => {
  it("the ticket page: on the non-manager's Technician line, a You badge when it is theirs and Claim when nobody has it", () => {
    const page = src("src/components/service-page.tsx");
    expect(page).toContain(
      '{job && job.technician_id === profile?.id && <Badge variant="secondary">You</Badge>}',
    );
    expect(page).toContain("{job && !job.technician_id && !manager && canClaim(profile) && (");
    // The line reads the TICKET's technician, not the page draft's (a claim changes the ticket
    // under a draft built when the page opened — "it just says unassigned and you").
    expect(page).toContain("const assignedId = job ? job.technician_id : draft.technician_id;");
    expect(page).toContain("{assignedId ? (techOptions.find((t) => t.id === assignedId)?.name ??");
    expect(page).toContain('set("technician_id", row.technician_id ?? "");');
    expect(page).toContain("onClick={() => claimMut.mutate(job.id)}");
    // Not in the manager's dispatch box: a manager assigns instead.
    expect(page).not.toContain(
      '<div className="flex min-w-0 flex-1 items-center gap-2"> <div className="min-w-0 flex-1">{techSelect(',
    );
  });
  it("Work Overview: the unassigned pane left of the calendar, rows draggable, a day accepts the drop with its date", () => {
    const page = src("src/components/my-work-page.tsx");
    expect(page).toContain("{claim && unassignedPane && (");
    expect(page).toContain(
      '<aside className="flex min-h-0 flex-col gap-2 xl:w-64 xl:shrink-0" aria-label="Unassigned">',
    );
    expect(page).toContain("e.dataTransfer.setData(dragKey, it.key);");
    expect(page).toContain(
      "const it = unassigned.find((u) => u.key === key); if (!it) return; e.preventDefault(); claim(it, d);",
    );
    // The row's Claim keeps the date; the drop sets it; only people who canClaim get either.
    expect(page).toContain("onClick={() => claim(item, null)}");
    expect(page).toContain("const claim: ClaimWork | null = canClaim(profile)");
    expect(page).toContain(
      'if (v.item.kind === "opportunity") await claimOppFn({ data: { id, date: v.date } });',
    );
    expect(page).toContain("unassignedPane={!!q.data?.unassigned}");
  });
});
