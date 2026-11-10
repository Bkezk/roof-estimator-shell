/**
 * /documents (owner, Oct 26: a CenterPoint-style document generator).
 *
 *   ?id=<document>            edit a bid's or ticket's document (its variables resolved)
 *   ?template=<id>            edit a template's pages, with sample variables
 *   ?template=new&kind=bid    a new template
 *
 * The editor itself is components/documents/editor-screen.tsx. Nov 10 (the speed pass, finding
 * 11): it is loaded only when the address names a document or a template — the bare address
 * shows a card and used to download the whole editor (168 KB packed) to do it.
 *
 * Who may open it (owner, Nov 10: "keep technicians off the documents page. Allow office users
 * to have access"): Documents access — admins, managers and anyone with Estimate, Invoices or
 * Customers access (access.ts hasDocumentsAccess; pageForPath: /documents → "documents"). The
 * central gate sends anyone else to their own home page.
 */
import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { documentSearch, TEMPLATES_ADMIN_PATH } from "@/lib/documents/editor-helpers";
import { Button } from "@/components/ui/button";

/** The editor, fetched when a document or a template is opened (never for the card below). */
const DocumentsEditorScreen = lazy(() => import("@/components/documents/editor-screen"));

export const Route = createFileRoute("/documents")({
  head: () => ({ meta: [{ title: "Documents — JBK Portal" }] }),
  validateSearch: documentSearch,
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const { id, template, kind } = Route.useSearch();
  if (id || template)
    return (
      <Suspense
        fallback={
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the editor…
          </div>
        }
      >
        <DocumentsEditorScreen
          {...(id ? { id } : {})}
          {...(template ? { template } : {})}
          {...(kind ? { kind } : {})}
        />
      </Suspense>
    );
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">Documents open from a bid or a ticket.</p>
      <p className="text-sm text-muted-foreground">
        Use "Documents" on the bid or ticket to make or open one. Templates are under Admin.
      </p>
      <Button asChild variant="outline">
        <a href={TEMPLATES_ADMIN_PATH}>Manage Templates</a>
      </Button>
    </div>
  );
}
