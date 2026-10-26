/**
 * "Inspection report" — one tap on an inspection ticket (phase 2 of the documents; owner,
 * Oct 26): the document is made from the shipped "Inspection report" template (found by name
 * among the ticket templates), photos and marks on, no prices, and the editor opens on it. No
 * dialog: the office presses the button, the report appears; nothing is made without the press.
 * Shown to whoever has documents access (access.ts hasDocumentsAccess); a technician-only user
 * never sees it. Rendered only for an inspection ticket (the callers check service_type).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardList, Loader2 } from "lucide-react";

import { newDocumentTitle } from "@/lib/documents/editor-helpers";
import {
  findInspectionTemplate,
  INSPECTION_REPORT_OPTIONS,
  NO_INSPECTION_TEMPLATE,
} from "@/lib/documents/inspection-report";
import { createDocument, listDocumentTemplates } from "@/lib/documents.functions";
import { Button } from "@/components/ui/button";

import { documentsKey, errText } from "./document-types";

export function InspectionReportButton(props: {
  serviceJobId: string;
  ticketNumber: number | string;
  size?: "sm" | "default" | undefined;
  className?: string | undefined;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listDocumentTemplates);
  const createFn = useServerFn(createDocument);
  const recordLabel = `Ticket ${props.ticketNumber}`;
  const make = useMutation({
    mutationFn: async () => {
      const templates = await listFn({ data: { kind: "ticket" } });
      const t = findInspectionTemplate(templates);
      if (!t) throw new Error(NO_INSPECTION_TEMPLATE);
      return createFn({
        data: {
          kind: "ticket",
          serviceJobId: props.serviceJobId,
          templateId: t.id,
          title: newDocumentTitle(t.name, { kind: "ticket", label: recordLabel }),
          options: INSPECTION_REPORT_OPTIONS,
        },
      });
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: documentsKey({ serviceJobId: props.serviceJobId }) });
      void navigate({ to: "/documents", search: { id: r.id } });
    },
    onError: (e) => toast.error(`Could not make the inspection report: ${errText(e)}`),
  });
  return (
    <Button
      type="button"
      size={props.size ?? "sm"}
      className={props.className}
      disabled={make.isPending}
      title="Make the inspection report from this ticket's checklist and photos, then open it in the editor"
      onClick={() => make.mutate()}
    >
      {make.isPending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <ClipboardList className="mr-1 h-4 w-4" />
      )}
      Inspection report
    </Button>
  );
}
