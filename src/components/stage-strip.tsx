/**
 * The stage stepper under a ticket's or an opportunity's header (owner, Oct 1): every stage /
 * status in order as a small dot on a line, its label and the date it was last entered beneath
 * (blank when never reached). Steps before the current one are filled when they were entered,
 * the current one is the primary dot with a ring and a bold label, steps after it are hollow and
 * muted — even when they carry a date from before the ticket moved back (audit, Oct 2; the date
 * stays, muted). The looks come from lib/stage-strip.ts (stepLooks). Left-aligned and capped in
 * width (owner, Oct 1: the full-width boxes "did not look great"). On a phone the steps wrap. The
 * cells come from lib/stage-dates.ts (ticketStageStrip / oppStatusStrip); the header's select
 * stays the way to change the stage.
 */
import { shortDate, type StripCell } from "@/lib/stage-dates";
import { stepLooks } from "@/lib/stage-strip";

export function StageStrip({ cells, label }: { cells: readonly StripCell[]; label: string }) {
  const looks = stepLooks(cells);
  return (
    <ol aria-label={label} className="flex max-w-3xl flex-wrap gap-y-3 text-xs">
      {cells.map((c, i) => {
        const look = looks[i]!;
        const last = i === cells.length - 1;
        return (
          <li
            key={c.key}
            data-stage={c.key}
            data-state={look.state}
            aria-current={c.current ? "step" : undefined}
            className={`flex min-w-[7rem] flex-col ${last ? "flex-none pr-2" : "flex-1"}`}
          >
            <div className="flex h-4 items-center">
              <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${look.dot}`} />
              {!last && <span aria-hidden className={`ml-2 mr-3 h-px flex-1 ${look.line}`} />}
            </div>
            <span className={`mt-1.5 leading-tight ${look.label}`}>{c.label}</span>
            <span className={`tabular-nums ${look.date}`}>{c.at ? shortDate(c.at) : " "}</span>
          </li>
        );
      })}
    </ol>
  );
}
