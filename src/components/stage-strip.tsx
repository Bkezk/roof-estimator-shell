/**
 * The stage strip under a ticket's or an opportunity's header (owner, Oct 1), like CenterPoint's
 * STAGES strip: every stage / status in order, the current one highlighted, each with the date it
 * was last entered underneath (blank when never reached). On a phone the cells wrap to two rows.
 * The cells come from lib/stage-dates.ts (ticketStageStrip / oppStatusStrip); the header's select
 * stays the way to change the stage.
 */
import { shortDate, type StripCell } from "@/lib/stage-dates";

export function StageStrip({ cells, label }: { cells: readonly StripCell[]; label: string }) {
  // Five ticket stages: 3 + 2 on a phone; four opportunity slots: 2 + 2. One row from sm up.
  const cols = cells.length >= 5 ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4";
  return (
    <ol aria-label={label} className={`grid ${cols} gap-1 text-center text-xs`}>
      {cells.map((c) => (
        <li
          key={c.key}
          data-stage={c.key}
          aria-current={c.current ? "step" : undefined}
          className={`min-w-0 rounded-md border px-2 py-1.5 ${
            c.current
              ? "border-primary bg-primary text-primary-foreground"
              : c.at
                ? "bg-muted/40"
                : "text-muted-foreground"
          }`}
        >
          <span className="block font-medium leading-tight">{c.label}</span>
          <span
            className={`block tabular-nums ${c.current ? "opacity-90" : "text-muted-foreground"}`}
          >
            {c.at ? shortDate(c.at) : "\u00a0"}
          </span>
        </li>
      ))}
    </ol>
  );
}
