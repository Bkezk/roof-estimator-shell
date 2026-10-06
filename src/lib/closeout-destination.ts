/**
 * Where Complete on the close-out sends someone (owner, Oct 6: an admin who is also ticked
 * Technician landed on Today instead of the ticket). A technician goes back to their day; the
 * office — anyone who sees every ticket, an admin or a manager with the Technician tick included
 * (access.ts isOffice) — back to the ticket, where the stage and the Close-out fold now agree.
 */
import { isOffice, type AccessLike } from "@/lib/access";

export type CloseoutDestination =
  { to: "/service/today" } | { to: "/service"; search: { id: string } };

export function closeoutDestination(
  profile: AccessLike | null | undefined,
  jobId: string,
): CloseoutDestination {
  return isOffice(profile) ? { to: "/service", search: { id: jobId } } : { to: "/service/today" };
}
