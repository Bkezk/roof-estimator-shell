/**
 * The Inspection and Aerial sections (owner, Sep 30), in one element so the ticket page and the
 * tech's close-out each take them with a single line. Inspection shows only on an Inspection
 * ticket; Aerial only when the ticket has an address.
 */
import { useAuth } from "@/lib/auth-store";
import { isOffice } from "@/lib/access";
import type { ServiceJobRow } from "@/lib/service.functions";
import { AerialSection } from "@/components/service/aerial-markup";
import { InspectionSection } from "@/components/service/inspection-section";

export function TicketExtras({ job, canEdit }: { job: ServiceJobRow; canEdit: boolean }) {
  const { profile } = useAuth();
  const officeOrAdmin = isOffice(profile);
  return (
    <>
      <InspectionSection job={job} canEdit={canEdit} officeOrAdmin={officeOrAdmin} />
      <AerialSection job={job} canEdit={canEdit} />
    </>
  );
}

export { FromInspectionNote } from "@/components/service/inspection-section";
