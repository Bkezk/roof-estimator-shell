/**
 * The chain line (owner, Nov 13: "show the whole chain"; lib/work-chain.ts has the rules):
 *
 *   Opportunity: Leak at the dock (Quoted) › Inspection #6041 (Done) › Bid: Dock re-roof (Submitted)
 *
 * on the opportunity, on its tickets and on the bid. Each part links to its record; the one being
 * looked at is bold and not a link. One read (getWorkChain) under the reader's own rights, so a
 * part they may not read is not there. While the chain has fewer than two parts — nothing before
 * or after this record that the reader can see — the line is not shown and `children` are: the
 * "From opportunity: …" / "From inspection #…" lines the pages had before, which still say what
 * they can (a ticket's opportunity the reader cannot open reads "From an opportunity").
 *
 * On a phone the line wraps (each part is one unbreakable piece only up to the screen's width).
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Workflow } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { chainText, type ChainKind, type ChainPart } from "@/lib/work-chain";
import { getWorkChain } from "@/lib/work-chain.functions";

const workChainKey = (kind: ChainKind, id: string) => ["work-chain", kind, id] as const;

function Part({ p }: { p: ChainPart }) {
  const text = (
    <>
      {p.label} <span className="text-muted-foreground">({p.status})</span>
    </>
  );
  if (p.current)
    return (
      <span className="font-semibold" aria-current="true" data-part={p.kind} data-current>
        {text}
      </span>
    );
  if (p.deleted)
    return (
      <span className="text-muted-foreground" data-part={p.kind} data-deleted>
        {text}
      </span>
    );
  const cls = "underline underline-offset-2";
  if (p.kind === "opportunity")
    return (
      <Link to="/opportunities" search={{ id: p.id }} className={cls} data-part={p.kind}>
        {text}
      </Link>
    );
  if (p.kind === "ticket")
    return (
      <Link to="/service" search={{ id: p.id }} className={cls} data-part={p.kind}>
        {text}
      </Link>
    );
  return (
    <Link to="/estimate" search={{ bid: p.id }} className={cls} data-part={p.kind}>
      {text}
    </Link>
  );
}

export function WorkChainLine({
  kind,
  id,
  children,
  className = "text-sm",
}: {
  kind: ChainKind;
  /** The record the line is drawn on; nothing is read without one (an unsaved bid). */
  id: string | null | undefined;
  /** Shown instead while there is no chain to show. */
  children?: ReactNode;
  /** The line's text size (the estimator's Setup column uses a smaller one). */
  className?: string;
}) {
  const { session } = useAuth();
  const getFn = useServerFn(getWorkChain);
  const q = useQuery({
    queryKey: workChainKey(kind, id ?? "none"),
    queryFn: () => getFn({ data: { kind, id: id! } }),
    enabled: !!session && !!id,
    staleTime: 60_000,
    retry: false,
  });
  const steps = q.data ?? [];
  if (!steps.length) return <>{children}</>;
  return (
    <p
      className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 ${className}`}
      data-line="work-chain"
      aria-label={`Where this came from and what came of it: ${chainText(steps)}`}
    >
      <Workflow className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden />
      {steps.map((step, i) => (
        <span key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground">
              ›
            </span>
          )}
          {step.map((p, j) => (
            <span key={`${p.kind}:${p.id}`} className="min-w-0 break-words">
              {j > 0 && (
                <span aria-hidden className="mr-1.5 text-muted-foreground">
                  ·
                </span>
              )}
              <Part p={p} />
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}
