import { createFileRoute } from "@tanstack/react-router";

import { CatalogEditor } from "@/components/catalog-editor";
import { AdhesivesTab } from "@/components/adhesives-editor";
import { ExceptionalMetalsTab } from "@/components/exceptional-metals-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DL_TABS = ["catalog", "adhesives", "metals"] as const;
type DlTab = (typeof DL_TABS)[number];

export const Route = createFileRoute("/admin/duro-last")({
  // `cat` deep-links to a catalog category by name (from the sidebar submenu).
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: DlTab; cat?: string } => ({
    ...(DL_TABS.includes(search["tab"] as DlTab) ? { tab: search["tab"] as DlTab } : {}),
    ...(typeof search["cat"] === "string" && search["cat"] ? { cat: search["cat"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Duro-Last Pricing — Bid-O-Matic" }] }),
  component: DuroLastPage,
});

function DuroLastPage() {
  const { tab, cat } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Duro-Last Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Duro-Last membrane, underlayment, fasteners, sealants, flashings, drains and accessories.
          Adhesives and Exceptional Metals have their own detail editors. Prices feed the Duro-Last
          items in a bid.
        </p>
      </div>
      <Tabs
        value={tab ?? "catalog"}
        onValueChange={(v) =>
          navigate({ search: { tab: v as DlTab }, replace: true })
        }
        className="space-y-4"
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="adhesives">Adhesives</TabsTrigger>
          <TabsTrigger value="metals">Exceptional Metals</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog">
          <CatalogEditor
            branch="duro_last"
            title="Duro-Last Pricing"
            hideHeader
            {...(cat ? { category: cat } : {})}
            onCategoryChange={(c) =>
              navigate({ search: { tab: "catalog", cat: c }, replace: true })
            }
          />
        </TabsContent>
        <TabsContent value="adhesives">
          <AdhesivesTab />
        </TabsContent>
        <TabsContent value="metals">
          <ExceptionalMetalsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
