import { createFileRoute } from "@tanstack/react-router";
import { CatalogEditor } from "@/components/catalog-editor";

export const Route = createFileRoute("/admin/non-dl")({
  // `cat` deep-links to a category by name (from the sidebar submenu).
  validateSearch: (search: Record<string, unknown>): { cat?: string } =>
    typeof search["cat"] === "string" && search["cat"] ? { cat: search["cat"] } : {},
  head: () => ({ meta: [{ title: "Non-DL Pricing — Bid-O-Matic" }] }),
  component: NonDlPage,
});

function NonDlPage() {
  const { cat } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CatalogEditor
      branch="non_dl"
      title="Non-Duro-Last Pricing"
      intro="Lumber, sheet metal, masonry, subcontractors, services and custom applications. Prices feed the Non-D/L items in a bid."
      {...(cat ? { category: cat } : {})}
      onCategoryChange={(c) => navigate({ search: { cat: c }, replace: true })}
    />
  );
}
