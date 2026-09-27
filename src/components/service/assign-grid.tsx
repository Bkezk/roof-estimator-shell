/**
 * Tech + day in one click (docs/service-module-design.md §5.1 step 4, owner Sep 27): a small
 * grid of technicians × today and the next six days on the ticket form. Each cell shows how
 * many tickets that technician has that day (Open / Scheduled / Done, from the cached
 * listServiceJobs list), counting this ticket where it is currently chosen. One click sets the
 * technician and the day together; clicking the chosen cell again clears both. A day beyond the
 * grid is set with the date input under it (the form keeps both in sync).
 *
 * On a phone the grid scrolls sideways with the name column fixed.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listServiceJobs } from "@/lib/service.functions";
import { loadCount, nextDays } from "@/lib/service-schedule";
import { cn } from "@/lib/utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface GridTech {
  id: string;
  name: string;
  technician: boolean;
}

export function AssignGrid(props: {
  /** The ticket being edited (null = new), so its saved slot is not counted twice. */
  jobId: string | null;
  /** Everyone assignable, technicians first (the form's technician options). */
  techs: GridTech[];
  techsLoading: boolean;
  /** "" = none. */
  technicianId: string;
  /** YYYY-MM-DD or "". */
  date: string;
  meId: string | null;
  disabled: boolean;
  onPick: (technicianId: string, date: string) => void;
}) {
  const { session } = useAuth();
  const listFn = useServerFn(listServiceJobs);
  // The same cache as the Tickets list and the Board, so usually no extra request.
  const jobsQ = useQuery({
    queryKey: ["service-jobs"],
    queryFn: () => listFn(),
    enabled: !!session,
  });
  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  // Recomputed per render; the grid rolls over at midnight on the next render.
  const days = nextDays(new Date());

  // Rows: the technicians; an office user or former assignee only while they are the choice
  // (the Technician select under the grid reaches everyone).
  const rows = props.techs.filter((t) => t.technician || t.id === props.technicianId);
  const self = { id: props.jobId, technician_id: props.technicianId, scheduled_date: props.date };

  if (props.techsLoading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading technicians…
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No technicians yet (Admin › Users › Technician). Pick anyone with the Technician select
        below.
      </p>
    );

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted text-xs text-muted-foreground">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-muted px-2 py-1.5 text-left font-medium"
              >
                Technician
              </th>
              {days.map((d) => (
                <th
                  key={d.ymd}
                  scope="col"
                  className={cn(
                    "px-1 py-1.5 text-center font-medium",
                    d.isToday && "text-foreground",
                    d.isWeekend && !d.isToday && "text-muted-foreground/70",
                  )}
                >
                  <span className="block leading-tight">
                    {d.weekday} {d.dayOfMonth}
                  </span>
                  {d.isToday && (
                    <span className="block text-[10px] font-semibold uppercase leading-tight text-primary">
                      Today
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[140px] truncate bg-background px-2 py-1 text-left font-medium"
                  title={t.name}
                >
                  {t.name}
                  {t.id === props.meId ? (
                    <span className="font-normal text-muted-foreground"> (me)</span>
                  ) : null}
                </th>
                {days.map((d) => {
                  const chosen = props.technicianId === t.id && props.date === d.ymd;
                  const n = loadCount(jobs, t.id, d.ymd, self);
                  return (
                    <td key={d.ymd} className={cn("p-0.5", d.isToday && "bg-muted/40")}>
                      <button
                        type="button"
                        disabled={props.disabled}
                        aria-pressed={chosen}
                        aria-label={`${t.name}, ${d.weekday} ${d.dayOfMonth}: ${n} ticket${n === 1 ? "" : "s"}${chosen ? " (chosen; click to clear)" : ""}`}
                        title={
                          chosen
                            ? "Chosen — click again to clear the technician and the day"
                            : `${n} ticket${n === 1 ? "" : "s"} that day`
                        }
                        className={cn(
                          "flex h-9 w-full min-w-[52px] items-center justify-center gap-1 rounded-md border text-xs tabular-nums transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                          chosen
                            ? "border-primary bg-primary font-semibold text-primary-foreground"
                            : "border-transparent hover:border-primary/40 hover:bg-muted",
                          !chosen && n === 0 && "text-muted-foreground/60",
                        )}
                        onClick={() => (chosen ? props.onPick("", "") : props.onPick(t.id, d.ymd))}
                      >
                        {chosen && <Check className="h-3.5 w-3.5" aria-hidden />}
                        {n > 0 ? n : chosen ? "" : "·"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jobsQ.error ? (
        <p className="text-xs text-destructive">
          Could not load the day counts: {errText(jobsQ.error)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Numbers are tickets that day. Click a cell to set the technician and the day; click it
          again to clear both.
          {jobsQ.isLoading ? " Loading counts…" : ""}
        </p>
      )}
    </div>
  );
}
