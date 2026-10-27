import { createFileRoute } from "@tanstack/react-router";

import { CatalogEditor } from "@/components/catalog-editor";

/**
 * EPDM Accessories (owner, Oct 26–27): the `epdm` catalog branch — the Non-DL TPO screens plus
 * Conduit Washers — the screens a bid's EPDM accessories group reads, shaped like the Duro-Last
 * ones so they compute the same way (EPDM parts are black and priced under the White column).
 * Item numbers on the rows, a price-list import updates them by number.
 */
export const Route = createFileRoute("/admin/epdm")({
  // `cat` deep-links to a category by name (from the sidebar submenu).
  validateSearch: (search: Record<string, unknown>): { cat?: string } =>
    typeof search["cat"] === "string" && search["cat"] ? { cat: search["cat"] } : {},
  head: () => ({ meta: [{ title: "EPDM Accessories — JBK Portal" }] }),
  component: EpdmPage,
});

function EpdmPage() {
  const { cat } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CatalogEditor
      branch="epdm"
      title="EPDM Accessories"
      intro="Sealants, corners, pipe stacks, drain boot accessories, walk pads, membrane accessories, termination bars, conduit washers, fasteners and the other accessories of an EPDM rubber roof (Firestone RubberGard / QuickSeam list prices as loaded; edit here or by a price-list import on the item numbers). These screens price a bid's EPDM accessories group and compute like the Duro-Last screens: a row named like the Duro-Last one counts the same way; black parts are priced under White."
      {...(cat ? { category: cat } : {})}
      onCategoryChange={(c) => navigate({ search: { cat: c }, replace: true })}
    />
  );
}
