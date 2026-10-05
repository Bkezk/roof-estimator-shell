/**
 * The Tickets list's filters (src/components/service-page.tsx ServiceList), pure so they are
 * tested without the screen: Mine, the stage chip, Overdue, Type, Technician and the search box.
 *
 * Technician (owner, Oct 5, service study M7 — CenterPoint's list filters by technician): one
 * person's tickets by the lead technician, the same person the Tech Board files the ticket under;
 * "unassigned" is tickets with nobody on them.
 */
import { isOpenTicketStage, isOverdueTicket, SERVICE_OPEN_WORK } from "@/lib/work-counts";

/** The Technician filter: everyone, nobody assigned, or one technician's id. */
export const TECH_ALL = "all";
export const TECH_UNASSIGNED = "unassigned";
export type TechFilter = typeof TECH_ALL | typeof TECH_UNASSIGNED | (string & {});

export interface ListTicket {
  number: number;
  stage: string;
  service_type: string;
  scheduled_date: string | null;
  technician_id: string | null;
  technician_name: string | null;
  customer_name: string | null;
  site_name: string | null;
  site_address: string | null;
  description: string | null;
  po_number: string | null;
  job_number: string | null;
  centerpoint_ticket: string | null;
  centerpoint_invoice: string | null;
}

export interface TicketListFilters {
  /** Only the signed-in person's tickets (their profile id), or null for everyone's. */
  mineId: string | null;
  /** "all", "openwork" or one stage. */
  stage: string;
  overdueOnly: boolean;
  /** "all" or one service type. */
  type: string;
  tech: TechFilter;
  search: string;
  today: string;
}

/** The text the search box looks in. */
function haystack(j: ListTicket): string {
  return [
    `#${j.number}`,
    String(j.number),
    j.customer_name,
    j.site_name,
    j.site_address,
    j.description,
    j.po_number,
    j.job_number,
    j.centerpoint_ticket,
    j.centerpoint_invoice,
    j.technician_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterTickets<T extends ListTicket>(jobs: T[], f: TicketListFilters): T[] {
  const q = f.search.trim().toLowerCase();
  return jobs.filter((j) => {
    if (f.mineId && j.technician_id !== f.mineId) return false;
    if (f.stage === SERVICE_OPEN_WORK) {
      if (!isOpenTicketStage(j.stage)) return false;
    } else if (f.stage !== "all" && j.stage !== f.stage) return false;
    if (f.overdueOnly && !isOverdueTicket(j, f.today)) return false;
    if (f.type !== "all" && j.service_type !== f.type) return false;
    if (f.tech === TECH_UNASSIGNED) {
      if (j.technician_id) return false;
    } else if (f.tech !== TECH_ALL && j.technician_id !== f.tech) return false;
    if (q && !haystack(j).includes(q)) return false;
    return true;
  });
}

/** The Technician select's choices: everyone with a ticket in the list, A–Z by name. */
export function techChoices(jobs: ListTicket[]): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const j of jobs)
    if (j.technician_id && !byId.has(j.technician_id))
      byId.set(j.technician_id, j.technician_name?.trim() || "Unnamed technician");
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
