import { createFileRoute } from "@tanstack/react-router";

import { CenterpointImportPage } from "@/components/centerpoint-import-page";

// Admins only: src/lib/access.ts pageForPath sends /admin/centerpoint-import to "admin".
export const Route = createFileRoute("/admin/centerpoint-import")({
  head: () => ({ meta: [{ title: "Import from CenterPoint — JBK Portal" }] }),
  component: CenterpointImportPage,
});
