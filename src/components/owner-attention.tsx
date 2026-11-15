/**
 * The Owner page's "Needs attention" list (owner, Nov 15: "keep the owner on top of things").
 * One box at the top of the People tab: the count, a line that sums it up, a filter by person,
 * then the rows in three groups — Not started, Not followed up, Waiting on the office. Each row
 * says how long it has waited (amber past the limit, red at twice the limit), what it is, what
 * is wrong, whose it is and, for a bid or an invoice, the dollars riding on it; the whole row is
 * a link to the item. Nothing here is a button that changes anything: a row leaves when the
 * work is done. The rules are lib/owner-attention.ts; the server reads the rows for admins only
 * (owner-attention.functions.ts).
 *
 * Blank until the rows arrive (never a placeholder 0). On a phone a row stacks: the wait and
 * the title on the first line, the sentence under it, the person and the dollars last.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import {
  ATTENTION_GROUPS,
  attentionMoney,
  attentionPeople,
  attentionSummary,
  groupRows,
  rowsFor,
  WHO_NOBODY,
  type AttentionRow,
} from "@/lib/owner-attention";
import { listOwnerAttention } from "@/lib/owner-attention.functions";
import { visibleToOwner } from "@/lib/owner-view";
import { localYmd } from "@/lib/tasks";
import { Button } from "@/components/ui/button";

export const OWNER_ATTENTION_KEY = ["owner-attention"] as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TONE: Record<AttentionRow["tone"], string> = {
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
};

function Row({ row }: { row: AttentionRow }) {
  const navigate = useNavigate();
  return (
    <a
      href={row.href}
      data-attention-row={row.kind}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void navigate({ href: row.href });
      }}
      className="grid grid-cols-[5.75rem_1fr_auto] items-center gap-x-3 gap-y-1 border-t px-3 py-2.5 transition-colors hover:bg-muted/50 sm:grid-cols-[5.75rem_1fr_9rem_6.5rem_1rem]"
    >
      <span
        className={`rounded-md px-1 py-1 text-center text-xs font-semibold tabular-nums ${TONE[row.tone]}`}
      >
        {row.ageText}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-snug">
          <span className="mr-1.5 rounded border px-1 py-px align-[1px] text-[11px] font-medium text-muted-foreground">
            {row.tag}
          </span>
          <span className="break-words">{row.title}</span>
        </span>
        <span className="block text-[13px] leading-snug text-muted-foreground">{row.why}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground sm:order-last" aria-hidden />
      <span
        className={`col-span-2 col-start-2 text-[13px] sm:col-span-1 sm:col-start-auto ${
          row.whoKey === WHO_NOBODY ? "font-semibold text-destructive" : ""
        }`}
      >
        {row.who}
        {row.amount !== null && (
          <span className="ml-2 font-semibold tabular-nums sm:hidden">
            {attentionMoney(row.amount)}
          </span>
        )}
      </span>
      <span className="hidden text-right text-sm font-semibold tabular-nums sm:block">
        {row.amount !== null ? attentionMoney(row.amount) : ""}
      </span>
    </a>
  );
}

export function OwnerAttention() {
  const { session, profile } = useAuth();
  const fn = useServerFn(listOwnerAttention);
  const q = useQuery({
    queryKey: OWNER_ATTENTION_KEY,
    queryFn: () => fn({ data: { today: localYmd(new Date()) } }),
    enabled: !!session && visibleToOwner(profile),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const errMsg = q.error ? errText(q.error) : null;
  useEffect(() => {
    if (errMsg)
      toast.error(`Could not load the Needs attention list: ${errMsg}`, { id: "owner-attention" });
  }, [errMsg]);
  const [who, setWho] = useState<string | null>(null);
  const d = q.data;
  const all = d?.rows ?? [];
  const people = attentionPeople(all);
  // A person whose last row has left: back to everyone.
  const picked = who !== null && people.some((p) => p.key === who) ? who : null;
  const rows = rowsFor(all, picked);

  return (
    <section className="overflow-hidden rounded-lg border" data-owner-attention>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/40 px-3 py-2.5">
        <h2 className="text-base font-semibold">Needs attention</h2>
        {d && all.length > 0 && (
          <span
            className="rounded-full bg-destructive px-2.5 py-0.5 text-xs font-bold tabular-nums text-destructive-foreground"
            data-attention-count
          >
            {all.length}
          </span>
        )}
        {people.length > 1 && (
          <div className="flex flex-wrap gap-1.5 sm:ml-auto" role="group" aria-label="Whose">
            <Button
              size="sm"
              variant={picked === null ? "default" : "outline"}
              className="h-7 rounded-full px-3 text-xs"
              aria-pressed={picked === null}
              onClick={() => setWho(null)}
            >
              Everyone
            </Button>
            {people.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={picked === p.key ? "default" : "outline"}
                className="h-7 rounded-full px-3 text-xs"
                aria-pressed={picked === p.key}
                onClick={() => setWho(p.key)}
              >
                {p.label} <span className="ml-1 tabular-nums opacity-70">{p.count}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      {errMsg && !d ? (
        <div className="space-y-2 p-3">
          <p className="text-sm text-destructive">
            Could not load the Needs attention list: {errMsg}
          </p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : !d ? (
        <p className="min-h-10 px-3 py-2.5 text-sm text-muted-foreground" />
      ) : (
        <>
          <p className="px-3 py-2 text-[13px] text-muted-foreground" data-attention-summary>
            {attentionSummary(all)}
          </p>
          {ATTENTION_GROUPS.map((g) => {
            const list = groupRows(rows, g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} data-attention-group={g.key}>
                <h3 className="flex items-center gap-2 px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.label}
                  <span className="font-medium tabular-nums opacity-70">{list.length}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </h3>
                {list.map((r) => (
                  <Row key={r.key} row={r} />
                ))}
              </div>
            );
          })}
          <p className="border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            A row leaves by itself when the work is done.
            {d.held > 0 &&
              ` ${d.held} on hold by a manager ${d.held === 1 ? "is" : "are"} left out until the hold ends.`}
            {!d.untouchedRead &&
              " Work its person has not started could not be read just now, so it is missing here."}
          </p>
        </>
      )}
    </section>
  );
}
