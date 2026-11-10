/**
 * The ticket's one read (getTicketBundle) put into each section's own cache, so the sections ask
 * for nothing when they mount (Nov 3: repairs, photos, time, timeline; Nov 10, speed finding 4:
 * also the crew, the materials used, the purchase orders, the contact log, the clock running on
 * the ticket and an inspection's record — six calls of the second round, gone).
 *
 * A part the bundle left out (that read refused or failed for this person) is not seeded: its
 * section then asks for itself and shows what it always showed. Pure, so the keys are tested.
 */
import type { QueryClient } from "@tanstack/react-query";

import type { TicketBundle } from "@/lib/service-field.functions";

import { fieldKeys } from "./field-utils";
import { inspectionKey } from "./inspection-draft";

/** The ticket's contact log, as the Activity block and the contact buttons key it. */
export const ticketContactLogKey = (jobId: string) => ["contact-log", "ticket", jobId] as const;

export function seedTicketCaches(
  qc: Pick<QueryClient, "setQueryData">,
  id: string,
  b: TicketBundle,
): void {
  qc.setQueryData(fieldKeys.repairs(id), b.repairs);
  qc.setQueryData(fieldKeys.photos(id), b.photos);
  qc.setQueryData(fieldKeys.time(id), b.time);
  qc.setQueryData(fieldKeys.events(id), b.events);
  if (b.crew !== undefined) qc.setQueryData(fieldKeys.crew(id), b.crew);
  if (b.materials !== undefined) qc.setQueryData(fieldKeys.materials(id), b.materials);
  if (b.pos !== undefined) qc.setQueryData(fieldKeys.pos(id), b.pos);
  if (b.contacts !== undefined) qc.setQueryData(ticketContactLogKey(id), b.contacts);
  // null is an answer ("no clock is running"); only a missing key means "not read".
  if (b.clock !== undefined) qc.setQueryData(fieldKeys.jobClock(id), b.clock);
  if (b.inspection !== undefined) qc.setQueryData(inspectionKey(id), b.inspection);
}
