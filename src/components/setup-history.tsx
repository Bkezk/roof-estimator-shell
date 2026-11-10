/**
 * Under each Setup tab (owner, Nov 10): who changed it last, and a fold with the last changes in
 * words ("Nov 10, 3:36 PM · Claude (admin) · Urgent Helper Travel bill rate 40 → 41"). The rows
 * are the database's own (setup-history.ts). Admins and managers only, like the page.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, History } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { seesEveryone } from "@/lib/access";
import { auditLine } from "@/lib/audit";
import { lastChangedLine, type SetupHistoryTab } from "@/lib/setup-history";
import { listSetupHistory } from "@/lib/setup-history.functions";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** The query key every Setup save refreshes. */
export const SETUP_HISTORY_KEY = ["setup-history"] as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SetupHistory({ tab }: { tab: SetupHistoryTab }) {
  const { profile, session } = useAuth();
  const listFn = useServerFn(listSetupHistory);
  const [open, setOpen] = useState(false);
  const allowed = seesEveryone(profile);
  const q = useQuery({
    queryKey: [...SETUP_HISTORY_KEY, tab],
    queryFn: () => listFn({ data: { tab } }),
    enabled: !!session && allowed,
  });
  if (!allowed) return null;
  const rows = q.data ?? [];
  return (
    <div className="border-t pt-3 text-xs text-muted-foreground" data-setup-history={tab}>
      {q.error ? (
        <p className="text-destructive">Could not load the history: {errText(q.error)}</p>
      ) : !q.data ? (
        <p>Loading the history…</p>
      ) : !rows.length ? (
        <p data-line="last-changed">
          No changes logged yet. Changes are recorded from Nov 10, 2026.
        </p>
      ) : (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left hover:text-foreground"
              aria-label={open ? "Fold the history" : "Show the history"}
            >
              <History className="h-4 w-4 shrink-0" aria-hidden />
              <span data-line="last-changed">{lastChangedLine(rows)}</span>
              <span className="ml-auto flex items-center gap-1 font-medium">
                History
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`}
                  aria-hidden
                />
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto" data-list="setup-history">
              {rows.map((r) => (
                <li key={r.id} className="break-words">
                  {auditLine(r)}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
