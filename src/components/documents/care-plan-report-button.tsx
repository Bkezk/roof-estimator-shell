/**
 * "Care plan report": one tap on an inspection ticket (owner, Nov 23: "add a care plan report").
 * It sits beside the Inspection report button and works the same way: the document is made from
 * the shipped "Care plan report" template (found by name among the ticket templates), photos
 * and marks on, no prices, and the editor opens on it so the office can still change anything.
 * It lists every row of the checklist with its pictures, the rows found OK included. No dialog,
 * and nothing is made, sent or attached without the press. Shown to whoever has documents
 * access (access.ts hasDocumentsAccess), exactly as the Inspection report button; a
 * technician-only user never sees it. Rendered only for an inspection ticket (the caller checks
 * service_type).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ListChecks, Loader2 } from "lucide-react";

import {
  CARE_PLAN_REPORT_OPTIONS,
  findCarePlanTemplate,
  NO_CARE_PLAN_TEMPLATE,
} from "@/lib/documents/care-plan-report";
import { newDocumentTitle } from "@/lib/documents/editor-helpers";
import { createDocument, listDocumentTemplates } from "@/lib/documents.functions";
import { Button } from "@/components/ui/button";

import { documentsKey, errText } from "./document-types";

export function CarePlanReportButton(props: {
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
      const t = findCarePlanTemplate(templates);
      if (!t) throw new Error(NO_CARE_PLAN_TEMPLATE);
      return createFn({
        data: {
          kind: "ticket",
          serviceJobId: props.serviceJobId,
          templateId: t.id,
          title: newDocumentTitle(t.name, { kind: "ticket", label: recordLabel }),
          options: CARE_PLAN_REPORT_OPTIONS,
        },
      });
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: documentsKey({ serviceJobId: props.serviceJobId }) });
      void navigate({ to: "/documents", search: { id: r.id } });
    },
    onError: (e) => toast.error(`Could not make the care plan report: ${errText(e)}`),
  });
  return (
    <Button
      type="button"
      variant="outline"
      size={props.size ?? "sm"}
      className={props.className}
      disabled={make.isPending}
      title="Make the care plan report: every row of this ticket's checklist with its pictures, then open it in the editor"
      onClick={() => make.mutate()}
    >
      {make.isPending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <ListChecks className="mr-1 h-4 w-4" />
      )}
      Care plan report
    </Button>
  );
}
