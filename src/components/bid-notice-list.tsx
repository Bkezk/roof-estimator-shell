/**
 * A list of the estimator's yellow notices, each with its own dismiss button (owner, Nov 19:
 * "the yellow bullet point notifications should be able to be dismissed individually"), and one
 * "Show N dismissed" button that brings back the ones dismissed from this list. What is
 * dismissed is kept on the bid (lib/bid-dismissed-notices.ts) and saved with its next Save.
 */
import { AlertTriangle, X } from "lucide-react";

import {
  dismissNotice,
  restoreNotices,
  showDismissedLabel,
  splitNotices,
} from "@/lib/bid-dismissed-notices";

export function BidNoticeList(props: {
  /** The heading over the list, e.g. "Check inputs". */
  title: string;
  notices: readonly string[];
  /** The bid's dismissed notices (every list of the bid shares the one record). */
  dismissed: readonly string[];
  onDismissed: (next: string[]) => void;
  /** A bid open read-only: nothing can be dismissed or brought back. */
  readOnly?: boolean;
  /** "box": its own yellow box. "plain": inside another notice's box. */
  tone?: "box" | "plain";
}) {
  const { title, notices, dismissed, onDismissed, readOnly = false, tone = "box" } = props;
  const { open, hidden } = splitNotices(notices, dismissed);
  if (!open.length && !hidden.length) return null;
  const showBack = hidden.length > 0 && (
    <button
      type="button"
      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-60"
      disabled={readOnly}
      onClick={() => onDismissed(restoreNotices(dismissed, hidden))}
      data-action="show-dismissed-notices"
    >
      {showDismissedLabel(hidden.length)}
    </button>
  );
  // Every notice of this list is dismissed: no yellow box, only the way to bring them back.
  if (!open.length) return <div data-bid-notices="all-dismissed">{showBack}</div>;
  return (
    <div
      data-bid-notices={tone}
      className={
        tone === "box"
          ? "rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
          : "text-xs text-amber-700 dark:text-amber-400"
      }
    >
      <div
        className={
          tone === "box"
            ? "mb-1 flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
            : "mb-0.5"
        }
      >
        {tone === "box" && <AlertTriangle className="h-3 w-3" aria-hidden />} {title}
      </div>
      <ul className="space-y-0.5">
        {open.map((w, i) => (
          <li key={`${i}|${w}`} className="flex items-start gap-1.5" data-bid-notice>
            <span aria-hidden className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-current" />
            <span className="min-w-0 flex-1">{w}</span>
            <button
              type="button"
              className="-my-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-amber-500/20 hover:text-foreground disabled:opacity-40"
              disabled={readOnly}
              aria-label={`Dismiss this notice: ${w}`}
              title="Dismiss this notice"
              onClick={() => onDismissed(dismissNotice(dismissed, w))}
              data-action="dismiss-notice"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {showBack && <div className="mt-1">{showBack}</div>}
    </div>
  );
}
