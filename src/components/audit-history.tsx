/**
 * The "History" fold (owner, Oct 1: "whatever is changed needs to be logged somewhere showing
 * what they did, when, and who"): the audit log of an invoice (with its lines), of a customer
 * (with its sites and contacts) or of a vendor, newest first, one line each — "Oct 1, 9:14 AM · RoAnna Sims
 * (sales) · Invoice 6012 line 'Labor' rate 85 → 95". Admins and managers only: management sees
 * it, a sales person does not see the history of their own edits (listAudit refuses them too).
 * Folded by default; the log is read when it is unfolded.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, History, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { seesEveryone } from "@/lib/access";
import { auditLine } from "@/lib/audit";
import { listAudit } from "@/lib/audit.functions";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** What has a History fold: an invoice, a customer (account) or a vendor. */
export type AuditFold = "invoice" | "account" | "vendor" | "ticket";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AuditHistory({
  entity,
  entityId,
  className = "border-t pt-3",
}: {
  entity: AuditFold;
  entityId: string;
  /** The fold's frame: a rule above it (inside a block) by default. */
  className?: string;
}) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  if (!seesEveryone(profile)) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          aria-label={open ? "Fold the history" : "Show the history"}
        >
          <History className="h-4 w-4" aria-hidden />
          History
          <ChevronDown
            className={`ml-auto h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <HistoryList entity={entity} entityId={entityId} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function HistoryList({ entity, entityId }: { entity: AuditFold; entityId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listAudit);
  const q = useQuery({
    queryKey: ["audit", entity, entityId],
    queryFn: () => listFn({ data: { entity, entity_id: entityId } }),
    enabled: !!session,
    refetchOnMount: "always",
  });
  if (q.error)
    return (
      <p className="mt-2 text-sm text-destructive">
        Could not load the history: {errText(q.error)}
      </p>
    );
  if (!q.data)
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the history…
      </p>
    );
  if (!q.data.length)
    return <p className="mt-2 text-sm text-muted-foreground">No changes logged yet.</p>;
  return (
    <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-xs">
      {q.data.map((r) => (
        <li key={r.id} className="break-words text-muted-foreground">
          {auditLine(r)}
        </li>
      ))}
    </ul>
  );
}
