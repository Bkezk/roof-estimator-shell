/**
 * The Tech Board (docs/service-module-design.md §5.2): a week grid of technicians × days, like
 * CenterPoint's board, the Tech Board tab of the Service page (owner, Oct 5; it used to sit
 * folded above the ticket list). Drag an unassigned ticket from the left rail onto a cell
 * (= technician + day), drag between cells to reschedule, drag back onto the rail to unassign;
 * click a ticket to open it. Colour = stage (STAGE_CHIP; the rail carries a legend and each of
 * its chips names its stage — owner, Oct 5: "color coded by status"). The rail lists Open /
 * Scheduled tickets missing a technician or a day, oldest first.
 *
 * Managers and admins only (owner, Oct 1: the manager dispatches; `managesTickets`):
 * assignServiceJob refuses anyone else, who is sent to /service/today instead. Drag and drop is native HTML5 (desktop); on a phone the grid
 * scrolls sideways and a tap opens the ticket.
 */
import { useMemo, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { ServiceTabs } from "@/components/service/service-tabs";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Plus,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import { weekLabel } from "@/lib/board-week";
import {
  assignServiceJob,
  listServiceJobs,
  SERVICE_STAGES,
  STAGE_LABELS,
  type ServiceJobWithTech,
  type ServiceStage,
} from "@/lib/service.functions";
import { listTechnicians } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { arrivalLabel } from "@/lib/arrival-window";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const asStage = (s: string): ServiceStage =>
  (SERVICE_STAGES as readonly string[]).includes(s) ? (s as ServiceStage) : "open";

// ---- Local calendar days (YYYY-MM-DD), never UTC midnight --------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The Monday of the week holding `d`. */
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const shortDay = (ymd: string) =>
  fromYmd(ymd).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const openedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Stage colours: open amber, scheduled blue, done green, invoiced / closed muted (owner, Oct 5:
 * Open used to be grey, which read as "no colour" next to the blue Scheduled chips on the rail).
 */
const STAGE_CHIP: Record<ServiceStage, string> = {
  open: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  scheduled:
    "border-blue-300 bg-blue-100 text-blue-950 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  done: "border-green-300 bg-green-100 text-green-950 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
  authorized:
    "border-teal-300 bg-teal-100 text-teal-950 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100",
  invoiced: "border-dashed border-border bg-background text-muted-foreground",
  closed: "border-dashed border-border bg-background text-muted-foreground",
};
/** Only Open / Scheduled tickets move on the board; Done and later are the tech's / billing's. */
const movable = (j: ServiceJobWithTech) => {
  const s = asStage(j.stage);
  return s === "open" || s === "scheduled";
};
/** The stage the server will set on a drop (assignServiceJob's rule), for the optimistic view. */
const stageAfter = (j: ServiceJobWithTech, tech: string | null, date: string | null) =>
  movable(j) ? (tech && date ? "scheduled" : "open") : j.stage;

/** The technician's phone page (its route is built separately). */
const TODAY_URL: string = "/service/today";
const DRAG_TYPE = "application/x-service-ticket";

interface Row {
  id: string;
  name: string;
}
interface Assign {
  job: ServiceJobWithTech;
  technician_id: string | null;
  technician_name: string | null;
  scheduled_date: string | null;
}

export function BoardPage({ week }: { week?: string | undefined }) {
  const { profile } = useAuth();
  if (!managesTickets(profile))
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">The board is for managers.</p>
        <p className="text-sm text-muted-foreground">Your tickets for the day are on Today.</p>
        <Button asChild>
          <Link to={TODAY_URL}>Go to Today</Link>
        </Button>
      </div>
    );
  return <Board week={week} />;
}

function Board({ week }: { week?: string | undefined }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listServiceJobs);
  const techFn = useServerFn(listTechnicians);
  const assignFn = useServerFn(assignServiceJob);

  const jobsQ = useQuery({
    queryKey: ["service-jobs"],
    queryFn: () => listFn(),
    enabled: !!session,
  });
  const techsQ = useQuery({
    queryKey: ["technicians"],
    queryFn: () => techFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const today = toYmd(new Date());
  const monday = mondayOf(week ? fromYmd(week) : new Date());
  const days = Array.from({ length: 7 }, (_, i) => toYmd(addDays(monday, i)));
  const goWeek = (d: Date | null) => {
    void navigate({
      to: "/service/board",
      search: d ? { week: toYmd(mondayOf(d)) } : {},
      replace: true,
    });
  };

  const [search, setSearch] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  /** The drop target under the pointer: "rail" or "<techId>|<ymd>". */
  const [over, setOver] = useState<string | null>(null);

  const assign = useMutation({
    mutationFn: (a: Assign) =>
      assignFn({
        data: { id: a.job.id, technician_id: a.technician_id, scheduled_date: a.scheduled_date },
      }),
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: ["service-jobs"] });
      const prev = qc.getQueryData<ServiceJobWithTech[]>(["service-jobs"]);
      qc.setQueryData<ServiceJobWithTech[]>(["service-jobs"], (old) =>
        (old ?? []).map((j) =>
          j.id === a.job.id
            ? {
                ...j,
                technician_id: a.technician_id,
                technician_name: a.technician_name,
                scheduled_date: a.scheduled_date,
                stage: stageAfter(j, a.technician_id, a.scheduled_date),
              }
            : j,
        ),
      );
      return { prev };
    },
    onError: (e, a, ctx) => {
      if (ctx?.prev) qc.setQueryData(["service-jobs"], ctx.prev);
      toast.error(`Could not move ticket #${a.job.number}: ${errText(e)}`, { duration: 10_000 });
    },
    onSuccess: (row) => {
      qc.setQueryData<ServiceJobWithTech[]>(["service-jobs"], (old) =>
        (old ?? []).map((j) => (j.id === row.id ? row : j)),
      );
    },
    onSettled: (_r, _e, a) => {
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
      void qc.invalidateQueries({ queryKey: ["service-job", a.job.id] });
      void qc.invalidateQueries({ queryKey: ["account"] });
      void qc.invalidateQueries({ queryKey: ["followups"] });
    },
  });

  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  const techs = useMemo(() => techsQ.data ?? [], [techsQ.data]);
  const inWeek = (j: ServiceJobWithTech) =>
    !!j.technician_id &&
    !!j.scheduled_date &&
    j.scheduled_date >= days[0]! &&
    j.scheduled_date <= days[6]!;

  // Rows: the technicians, then (folded) anyone else holding a ticket this week — an office
  // user, or a former technician no longer on the roster.
  const techRows: Row[] = techs
    .filter((t) => t.technician)
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const techIds = new Set(techRows.map((r) => r.id));
  const otherRows: Row[] = [];
  for (const j of jobs) {
    if (
      !inWeek(j) ||
      techIds.has(j.technician_id!) ||
      otherRows.some((r) => r.id === j.technician_id)
    )
      continue;
    const t = techs.find((x) => x.id === j.technician_id);
    otherRows.push({
      id: j.technician_id!,
      name: t?.name ?? j.technician_name ?? "Former assignee",
    });
  }
  otherRows.sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (id: string) =>
    techRows.find((r) => r.id === id)?.name ?? otherRows.find((r) => r.id === id)?.name ?? null;

  const cellJobs = (techId: string, ymd: string) =>
    jobs
      .filter((j) => j.technician_id === techId && j.scheduled_date === ymd)
      .sort((a, b) => a.number - b.number);

  const q = search.trim().toLowerCase();
  const unassigned = jobs
    .filter((j) => movable(j) && (!j.technician_id || !j.scheduled_date))
    .filter((j) => {
      if (!q) return true;
      return [
        `#${j.number}`,
        j.customer_name,
        j.site_name,
        j.site_address,
        j.description,
        j.po_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const unassignedTotal = jobs.filter(
    (j) => movable(j) && (!j.technician_id || !j.scheduled_date),
  ).length;

  // ---- Drag and drop ---------------------------------------------------------------------------
  const dragged = dragId ? jobs.find((j) => j.id === dragId) : undefined;
  const startDrag = (e: DragEvent, j: ServiceJobWithTech) => {
    e.dataTransfer.setData(DRAG_TYPE, j.id);
    e.dataTransfer.setData("text/plain", `#${j.number}`);
    e.dataTransfer.effectAllowed = "move";
    setDragId(j.id);
  };
  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };
  const allowDrop = (e: DragEvent, key: string) => {
    if (!dragged && !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== key) setOver(key);
  };
  const leave = (e: DragEvent, key: string) => {
    // Ignore leaving into a child of the same target.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (over === key) setOver(null);
  };
  const dropOn = (e: DragEvent, techId: string | null, ymd: string | null) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
    endDrag();
    const job = jobs.find((j) => j.id === id);
    if (!job || !movable(job)) return;
    if (job.technician_id === techId && job.scheduled_date === ymd) return;
    // Onto the rail: unassign (no technician); the ticket keeps its day — every ticket has a
    // date (owner, Oct 1).
    assign.mutate({
      job,
      technician_id: techId,
      technician_name: techId ? nameOf(techId) : null,
      scheduled_date: ymd ?? job.scheduled_date,
    });
  };

  const loading = jobsQ.isLoading || techsQ.isLoading;
  const error = jobsQ.error ?? techsQ.error;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarDays className="h-6 w-6" /> Tech Board
          </h1>
          <p className="text-sm text-muted-foreground">
            Drag a ticket onto a technician&apos;s day to schedule it; drag it back to the left to
            unassign. Click a ticket to open it.
          </p>
          <div className="mt-2">
            <ServiceTabs />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link to="/service" search={{ new: 1 }}>
              <Plus className="mr-1 h-4 w-4" /> New ticket
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous week"
          onClick={() => goWeek(addDays(monday, -7))}
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={days.includes(today)}
          onClick={() => goWeek(null)}
        >
          This week
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next week"
          onClick={() => goWeek(addDays(monday, 7))}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-1 text-sm font-medium">{weekLabel(days[0]!, days[6]!)}</span>
        {assign.isPending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
          </span>
        )}
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Could not load the board ({errText(error)}). Try refreshing, or sign in again.
        </p>
      ) : loading || !jobsQ.data || !techsQ.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the board…
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Unassigned rail — above the grid on a phone. */}
          <aside
            aria-label="Unassigned tickets"
            className={`flex max-h-[70vh] flex-col gap-2 rounded-lg border p-3 transition-colors lg:max-h-[calc(100vh-14rem)] ${
              over === "rail" ? "border-primary bg-primary/5" : "bg-muted/30"
            }`}
            onDragOver={(e) => allowDrop(e, "rail")}
            onDragLeave={(e) => leave(e, "rail")}
            onDrop={(e) => dropOn(e, null, null)}
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Inbox className="h-4 w-4" /> Unassigned
              <span className="text-xs font-normal text-muted-foreground">{unassignedTotal}</span>
            </h2>
            <StageLegend stages={["open", "scheduled"]} />
            <Input
              type="search"
              placeholder="Search #, customer, site…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 bg-background"
            />
            <div className="-mr-1 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {unassigned.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {unassignedTotal === 0
                    ? "Every open ticket has a technician and a day."
                    : "No unassigned tickets match."}
                </p>
              ) : (
                unassigned.map((j) => (
                  <TicketChip
                    key={j.id}
                    job={j}
                    detail
                    dragging={dragId === j.id}
                    onDragStart={startDrag}
                    onDragEnd={endDrag}
                  />
                ))
              )}
            </div>
          </aside>

          {/* Week grid — scrolls sideways on a phone. */}
          <div className="overflow-x-auto rounded-lg border">
            <div
              className="grid min-w-[980px]"
              style={{ gridTemplateColumns: "150px repeat(7, minmax(110px, 1fr))" }}
              role="grid"
              aria-label={`Tech Board, week of ${weekLabel(days[0]!, days[6]!)}`}
            >
              <div className="sticky left-0 z-10 border-b bg-background p-2 text-xs font-medium text-muted-foreground">
                Technician
              </div>
              {days.map((d, i) => (
                <div
                  key={d}
                  role="columnheader"
                  className={`border-b border-l p-2 text-center text-xs ${
                    d === today ? "bg-primary/10 font-semibold text-primary" : "font-medium"
                  }`}
                >
                  <div>{DAY_NAMES[i]}</div>
                  <div className={d === today ? "" : "text-muted-foreground"}>{shortDay(d)}</div>
                </div>
              ))}

              {techRows.length === 0 && (
                <div className="col-span-8 border-b p-4 text-sm text-muted-foreground">
                  No technicians yet. An admin marks people as technicians on Admin › Users &amp;
                  access.
                </div>
              )}
              {techRows.map((r) => (
                <BoardRow
                  key={r.id}
                  row={r}
                  days={days}
                  today={today}
                  over={over}
                  dragId={dragId}
                  cellJobs={cellJobs}
                  allowDrop={allowDrop}
                  leave={leave}
                  dropOn={dropOn}
                  startDrag={startDrag}
                  endDrag={endDrag}
                />
              ))}

              {otherRows.length > 0 && (
                <>
                  <button
                    type="button"
                    className="col-span-8 flex items-center gap-2 border-b bg-muted/40 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide hover:bg-muted"
                    aria-expanded={showOthers}
                    onClick={() => setShowOthers((v) => !v)}
                  >
                    {showOthers ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    Others
                    <span className="font-normal normal-case text-muted-foreground">
                      {otherRows.length} with tickets this week
                    </span>
                  </button>
                  {showOthers &&
                    otherRows.map((r) => (
                      <BoardRow
                        key={r.id}
                        row={r}
                        days={days}
                        today={today}
                        over={over}
                        dragId={dragId}
                        cellJobs={cellJobs}
                        allowDrop={allowDrop}
                        leave={leave}
                        dropOn={dropOn}
                        startDrag={startDrag}
                        endDrag={endDrag}
                      />
                    ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BoardRow(props: {
  row: Row;
  days: string[];
  today: string;
  over: string | null;
  dragId: string | null;
  cellJobs: (techId: string, ymd: string) => ServiceJobWithTech[];
  allowDrop: (e: DragEvent, key: string) => void;
  leave: (e: DragEvent, key: string) => void;
  dropOn: (e: DragEvent, techId: string | null, ymd: string | null) => void;
  startDrag: (e: DragEvent, j: ServiceJobWithTech) => void;
  endDrag: () => void;
}) {
  const { row: r } = props;
  return (
    <>
      <div
        role="rowheader"
        className="sticky left-0 z-10 truncate border-b bg-background p-2 text-sm font-medium"
        title={r.name}
      >
        {r.name}
      </div>
      {props.days.map((d) => {
        const key = `${r.id}|${d}`;
        const items = props.cellJobs(r.id, d);
        return (
          <div
            key={d}
            role="gridcell"
            aria-label={`${r.name}, ${shortDay(d)}`}
            className={`group relative min-h-[76px] space-y-1 border-b border-l p-1.5 pb-7 transition-colors ${
              props.over === key
                ? "bg-primary/10 ring-2 ring-inset ring-primary"
                : d === props.today
                  ? "bg-primary/5"
                  : ""
            }`}
            onDragOver={(e) => props.allowDrop(e, key)}
            onDragLeave={(e) => props.leave(e, key)}
            onDrop={(e) => props.dropOn(e, r.id, d)}
          >
            {items.map((j) => (
              <TicketChip
                key={j.id}
                job={j}
                dragging={props.dragId === j.id}
                onDragStart={props.startDrag}
                onDragEnd={props.endDrag}
              />
            ))}
            <Link
              to="/service"
              search={{ new: 1, tech: r.id, date: d }}
              className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md border bg-background text-muted-foreground opacity-100 shadow-sm hover:text-foreground focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              title={`New ticket for ${r.name} on ${shortDay(d)}`}
              aria-label={`New ticket for ${r.name} on ${shortDay(d)}`}
              draggable={false}
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          </div>
        );
      })}
    </>
  );
}

/** One ticket on the board: "#6001 Customer · description", coloured by stage. */
/** What the chip colours mean (owner, Oct 5): one swatch per stage, in board order. */
function StageLegend({ stages }: { stages: readonly ServiceStage[] }) {
  return (
    <ul
      className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
      aria-label="Colours"
    >
      {stages.map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-sm border ${STAGE_CHIP[s]}`}
            aria-hidden
          />
          {STAGE_LABELS[s]}
        </li>
      ))}
    </ul>
  );
}

function TicketChip(props: {
  job: ServiceJobWithTech;
  /** The rail's chips also say what is already set (a technician without a day, or the reverse). */
  detail?: boolean;
  dragging: boolean;
  onDragStart: (e: DragEvent, j: ServiceJobWithTech) => void;
  onDragEnd: () => void;
}) {
  const j = props.job;
  const stage = asStage(j.stage);
  const canDrag = stage === "open" || stage === "scheduled";
  const partial = props.detail
    ? j.technician_id
      ? `${j.technician_name ?? "Assigned"} · no day`
      : j.scheduled_date
        ? `${shortDay(j.scheduled_date)} · no technician`
        : null
    : null;
  const arrival = arrivalLabel(j.arrival_window);
  const title = [
    `#${j.number} ${j.customer_name}`,
    arrival,
    j.site_name,
    j.description,
    STAGE_LABELS[stage],
    canDrag ? "Drag to schedule · click to open" : "Click to open",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Link
      to="/service"
      search={{ id: j.id }}
      draggable={canDrag}
      onDragStart={canDrag ? (e) => props.onDragStart(e, j) : (e) => e.preventDefault()}
      onDragEnd={props.onDragEnd}
      title={title}
      className={`block rounded-md border px-1.5 py-1 text-xs leading-snug shadow-sm transition-opacity hover:ring-1 hover:ring-primary/50 ${
        STAGE_CHIP[stage]
      } ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${props.dragging ? "opacity-40" : ""}`}
    >
      <span className="line-clamp-2">
        <span className="font-semibold">#{j.number}</span> {j.customer_name}
        {j.description ? <span className="opacity-80"> · {j.description}</span> : null}
      </span>
      {arrival && <span className="mt-0.5 block truncate text-[11px] font-medium">{arrival}</span>}
      {props.detail && (
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          <span className="font-medium">{STAGE_LABELS[stage]}</span>
          {j.site_name ? ` · ${j.site_name}` : ""}
          {` · ${partial ?? `opened ${openedOn(j.created_at)}`}`}
        </span>
      )}
    </Link>
  );
}
