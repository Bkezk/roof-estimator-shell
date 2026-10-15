/**
 * A section's folding header on a customer's page and a property's page (owner, Oct 15: "lets
 * make these collapsible so if there's 100 tickets it won't take up the whole page"). The whole
 * title row is the toggle — chevron, icon, title, count, an optional summary — and the section's
 * action (Add property, Link a bid, New task), passed as the children, sits beside it as its own
 * element, so a click on it never folds the section. The rules (default by count, remembered per
 * user) are lib/customer-folds.ts and lib/use-section-fold.ts; the sections keep their own
 * `<section>` card around this header.
 */
import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

export function FoldHeader(props: {
  open: boolean;
  onToggle: () => void;
  icon: LucideIcon;
  title: string;
  /** Shown beside the title when a number (left out while the rows load). */
  count?: number | null | undefined;
  /** A short line after the count, e.g. "12 tickets · 2 open · 9 closed". */
  summary?: string | null | undefined;
  /** The section's button(s): beside the toggle, never inside it. */
  children?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div
      className="flex items-center justify-between gap-2"
      data-fold={props.open ? "open" : "folded"}
    >
      <h2 className="min-w-0 flex-1 font-semibold">
        <button
          type="button"
          aria-expanded={props.open}
          title={props.open ? `Fold ${props.title}` : `Show ${props.title}`}
          className="-mx-1 flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={props.onToggle}
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              props.open ? "" : "-rotate-90"
            }`}
            aria-hidden
          />
          <Icon className="h-4 w-4 shrink-0" aria-hidden /> {props.title}
          {typeof props.count === "number" && (
            <span className="text-xs font-normal text-muted-foreground">{props.count}</span>
          )}
          {props.summary && (
            <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
              · {props.summary}
            </span>
          )}
        </button>
      </h2>
      {props.children}
    </div>
  );
}
