import { createFileRoute } from "@tanstack/react-router";

import { CatalogEditor } from "@/components/catalog-editor";
import {
  isNonDlMembraneRow,
  MEMBRANE_CATEGORY,
  NON_DL_MEMBRANE_NEW_ROW,
} from "@/lib/non-dl-membrane";

/**
 * Non-DL TPO and EPDM (owner, Oct 22): the non-Duro-Last membranes and their thicknesses, moved
 * out of the Duro-Last Membrane tab to a page of their own under Non Duro-Last Pricing. A view
 * only: the rows stay in the Duro-Last Membrane screen the engine reads, this page shows just the
 * two families and merges its edits back into that screen on save (lib/non-dl-membrane.ts).
 */
export const Route = createFileRoute("/admin/non-dl-membrane")({
  head: () => ({ meta: [{ title: "Non-DL TPO and EPDM — JBK Portal" }] }),
  component: NonDlMembranePage,
});

function NonDlMembranePage() {
  return (
    <CatalogEditor
      branch="duro_last"
      title="Non-DL TPO and EPDM"
      intro="Non-Duro-Last TPO and EPDM Rubber membrane by thickness, priced per colour like the Duro-Last membrane. A row's name carries the family and the thickness (Non-DL TPO - 60, EPDM Rubber - 90), which is how a bid finds its price."
      category={MEMBRANE_CATEGORY}
      hideCategoryPicker
      rowFilter={(_category, row, labelCol) => isNonDlMembraneRow(row, labelCol)}
      newRowLabel={NON_DL_MEMBRANE_NEW_ROW}
    />
  );
}
