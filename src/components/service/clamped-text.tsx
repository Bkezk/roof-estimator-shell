/**
 * Long words kept short where a technician works (owner, Nov 18, of the top of the workflow:
 * "this is a bit busy any way to make it cleaner? especially if there is a lot of special
 * instructions or activities?"). The text stops at a set number of lines and "Show all" opens
 * the rest in place. A text that fits is shown whole, with no button.
 *
 *  * ClampedText: a paragraph that stops at two or three lines.
 *  * PeekRow: one bordered row, "History · 2 earlier tickets ›", that opens something.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

export const SHOW_ALL = "Show all";
export const SHOW_LESS = "Show less";

/** Whole class names, so the stylesheet keeps them. */
const CLAMP = { 2: "line-clamp-2", 3: "line-clamp-3" } as const;
export type ClampLines = keyof typeof CLAMP;

export function ClampedText({
  text,
  lines,
  className = "",
  name,
}: {
  text: string;
  lines: ClampLines;
  className?: string;
  /** What is cut, for the tests and the browser checks: "instructions", "description". */
  name: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  // Longer than its lines? Asked of the page itself, again when the screen turns or resizes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, lines, open]);
  return (
    <div data-clamp={name} data-clamp-state={open ? "open" : long ? "cut" : "whole"}>
      <p ref={ref} className={`${className} ${open ? "" : CLAMP[lines]}`}>
        {text}
      </p>
      {(long || open) && (
        <button
          type="button"
          className="-ml-1 mt-0.5 flex min-h-9 items-center gap-1 rounded px-1 text-xs font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          data-clamp-toggle={name}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? SHOW_LESS : SHOW_ALL}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      )}
    </div>
  );
}

/** "[icon] History · 2 earlier tickets · last Nov 25 ›": one row, one tap. */
export function PeekRow({
  icon: Icon,
  iconClassName = "text-muted-foreground",
  label,
  detail,
  title,
  expanded,
  popup = false,
  name,
  onClick,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  /** The short words after the label; cut with an ellipsis when the row is narrow. */
  detail: string;
  title?: string;
  /** For a row that opens in place: whether it is open. Left out for one that opens a pop-up. */
  expanded?: boolean | undefined;
  popup?: boolean;
  name: string;
  onClick: () => void;
}) {
  const Chevron = expanded === undefined ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      className="flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={title}
      aria-haspopup={popup ? "dialog" : undefined}
      aria-expanded={expanded}
      data-peek-row={name}
      onClick={onClick}
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} aria-hidden />
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">· {detail}</span>
      <Chevron
        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        aria-hidden
      />
    </button>
  );
}
