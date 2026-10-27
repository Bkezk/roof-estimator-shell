import { createFileRoute } from "@tanstack/react-router";

import { CatalogEditor } from "@/components/catalog-editor";

/**
 * Non-DL TPO Accessories (owner, Oct 26–27: "in estimate pricing add non dl tpo and epdm
 * accessories as an option under non dl tpo and epdm. this will hold all the newly added
 * accessories pricing and item numbers"): the `non_dl_tpo` catalog branch — Sealants, Corners,
 * Pipe Stacks, Drain Boot Accessories, Walk Pads & Wall Vents, Membrane Accs, Termination Bars,
 * Fasteners & Bits, Other Accessories — the screens a bid's Non-DL TPO accessories group reads,
 * shaped like the Duro-Last ones so they compute the same way. Item numbers on the rows, a
 * price-list import updates them by number.
 */
export const Route = createFileRoute("/admin/non-dl-tpo")({
  // `cat` deep-links to a category by name (from the sidebar submenu).
  validateSearch: (search: Record<string, unknown>): { cat?: string } =>
    typeof search["cat"] === "string" && search["cat"] ? { cat: search["cat"] } : {},
  head: () => ({ meta: [{ title: "Non-DL TPO Accessories — JBK Portal" }] }),
  component: NonDlTpoPage,
});

function NonDlTpoPage() {
  const { cat } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CatalogEditor
      branch="non_dl_tpo"
      title="Non-DL TPO Accessories"
      intro="Sealants, corners, pipe stacks, drain boot accessories, walk pads, membrane accessories, termination bars, fasteners and the other accessories of a non-Duro-Last TPO roof (Firestone UltraPly and Universal-System list prices as loaded; edit here or by a price-list import on the item numbers). These screens price a bid's Non-DL TPO accessories group and compute like the Duro-Last screens: a row named like the Duro-Last one counts the same way."
      {...(cat ? { category: cat } : {})}
      onCategoryChange={(c) => navigate({ search: { cat: c }, replace: true })}
    />
  );
}
