import { createFileRoute } from "@tanstack/react-router";

import { AdhesivesTab } from "@/components/adhesives-editor";
import {
  isNonDlAdhesive,
  NON_DL_ADHESIVE_DEFAULT_GROUP,
  NON_DL_ADHESIVES_TITLE,
} from "@/lib/non-dl-adhesives";

/**
 * Non-DL TPO and EPDM Adhesives (owner, Oct 27): the Firestone bonding adhesives and the I.S.O.
 * insulation adhesives, moved out of the Duro-Last › Adhesives dropdown to a page of their own
 * under Non Duro-Last Pricing. A view only: the products stay in the one adhesives screen the
 * engine reads, this page shows just the non-DL ones and merges its edits back into that screen
 * on save (lib/non-dl-adhesives.ts).
 */
export const Route = createFileRoute("/admin/non-dl-adhesives")({
  head: () => ({ meta: [{ title: `${NON_DL_ADHESIVES_TITLE} — JBK Portal` }] }),
  component: NonDlAdhesivesPage,
});

function NonDlAdhesivesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{NON_DL_ADHESIVES_TITLE}</h1>
        <p className="text-sm text-muted-foreground">
          The Firestone bonding adhesives (Non-DL TPO and EPDM Rubber coverage groups) and the
          I.S.O. insulation adhesives, priced per unit with their coverage by substrate. A product
          belongs here by its Non-DL TPO / EPDM Rubber coverage group or its W56 part number; the
          Duro-Last, Duro-Tuff, Duro-Fleece and TECH-Bond adhesives stay under Duro-Last Pricing ›
          Adhesives. Both pages edit the one adhesives list a bid reads.
        </p>
      </div>
      <AdhesivesTab
        productFilter={isNonDlAdhesive}
        newProductGroup={NON_DL_ADHESIVE_DEFAULT_GROUP}
      />
    </div>
  );
}
