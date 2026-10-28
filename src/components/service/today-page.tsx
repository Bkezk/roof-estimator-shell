/**
 * My tickets — the technician's day on the phone (docs/service-module-design.md §5.3): the
 * signed-in person's open tickets, today's first, each with the clock's buttons and Open ticket.
 *
 * The clock (owner, Oct 15, CenterPoint-style: "the technicians clock into travel, then clock
 * into the job; while they're out, if they're going to another job they clock into travel for
 * that job, then into the job once they get there, then they can edit time later"): one running
 * clock per technician (tech-clock.ts; myClock / setFieldStatus in service-field.functions.ts).
 * A banner at the top says where it is ("Travelling to #6014 Bell County · 12 m", ticking every
 * 30 s) with the next buttons. Each card offers what comes next: no clock on it → Start travel
 * and On site (arriving without having pressed travel is fine); travelling to it → On site; on
 * site → Leave site and Complete. A clock running on ANOTHER ticket moves: pressing Start travel
 * or On site here closes it there (the toast says "Left #6012 · 0.75 h labor logged", from the
 * server's report of the press, never the cached clock — Oct 28) — one clock per technician. Every close writes a time entry with the real start and end (source
 * 'clock') that the Time section lets the technician edit. The Oct 8 "one button" screen
 * (owner: "we dont need the en route then on site buttons") is superseded by this: the buttons
 * are back as the clock, Oct 15.
 *
 * Open ticket (and Complete) open the close-out (closeout.tsx), which saves as it is filled out
 * and can be left and come back to any time (photos before, then after); its Complete clocks the
 * technician out of this ticket and sets it Done. Everyone sees their own tickets only, the
 * office included (owner, Oct 9: "it should probably be called my tickets"); the URL stays
 * /service/today.
 *
 * The crew question ("Who is on this job with you?", crew-box.tsx) is the close-out's first
 * section; a card whose crew is already answered names it and "Change" reopens it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ClipboardList,
  Loader2,
  LogOut,
  MapPin,
  MapPinCheck,
  Phone,
  RefreshCw,
  Truck,
  Users,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  myClock,
  myDay,
  setFieldStatus,
  type FieldStatusResult,
  type MyClock,
  type TodayJob,
} from "@/lib/service-field.functions";
import type { ServiceJobWithTech } from "@/lib/service.functions";
import { seedJobFromToday } from "@/lib/job-cache";
import { CLOCK_MOVED_LINE, cardActions, pressLine, runningLabel } from "@/lib/tech-clock";
import { Button } from "@/components/ui/button";
import { CrewBox } from "@/components/service/crew-box";
import { usePictures } from "@/components/service/picture-queue";
import { UploadBadge, WaitingForSignalLine } from "@/components/service/picture-queue-ui";
import { HistoryLink } from "@/components/service/site-history";
import { arrivalLabel, dayWithWindow } from "@/lib/arrival-window";
import { WarrantyBadgeList } from "@/components/crm/site-warranties";
import {
  errText,
  fieldKeys,
  localYmd,
  loudError,
  shortDay,
} from "@/components/service/field-utils";

const mapsUrl = (q: string) => `https://maps.google.com/?q=${encodeURIComponent(q)}`;

/**
 * The phone's calendar day (field-utils.ts localYmd), checked once a minute so the Today /
 * Coming up split flips at midnight without a reload (Oct 28 audit: the 30-second clock tick
 * used to live on the page and re-render every card twice a minute; it is the banner's now,
 * useTick below). The same day sets the same state, so nothing re-renders until it changes.
 */
function useLocalDay(): string {
  const [day, setDay] = useState(() => localYmd());
  useEffect(() => {
    const t = setInterval(() => setDay((d) => (localYmd() === d ? d : localYmd())), 60_000);
    return () => clearInterval(t);
  }, []);
  return day;
}

/** The clock's ticking "now": every 30 s, so the banner's minutes move (the banner's alone). */
function useTick(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

type ClockAction = "en_route" | "on_site" | "leave" | "undo";

/**
 * A clock press on a ticket: setFieldStatus with the phone's day (field-day.ts), then the day,
 * the clock and the ticket's time (and the ticket the clock left) are re-read. The toast says
 * what started and what stopped from the SERVER's report of the press (tech-clock.ts pressLine
 * fed FieldStatusResult.transition; audit risk 3, Oct 28) — never from the clock this phone had
 * cached, which another device may have closed already. A press the server found already moved
 * on another device gets one plain line and the re-read (audit risk 2). A failure is loud.
 */
function useClockPress(ticket: { id: string; number: number; customer_name: string }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(setFieldStatus);
  return useMutation({
    mutationFn: (to: ClockAction): Promise<FieldStatusResult> =>
      statusFn({ data: { id: ticket.id, to, day: localYmd() } }),
    onSuccess: ({ transition, warning }, to) => {
      if (transition.note === "moved") toast.info(CLOCK_MOVED_LINE);
      else toast.success(pressLine(transition, to, ticket));
      if (warning) toast.warning(warning);
      // The ticket the clock left, when it was another one: its time and timeline changed too.
      const left =
        transition.close && transition.close.jobId !== ticket.id ? transition.close.jobId : null;
      const keys: readonly (readonly string[])[] = [
        fieldKeys.today,
        fieldKeys.clock,
        fieldKeys.time(ticket.id),
        fieldKeys.job(ticket.id),
        fieldKeys.events(ticket.id),
        ...(left ? [fieldKeys.time(left), fieldKeys.job(left), fieldKeys.events(left)] : []),
        ["service-jobs"],
      ];
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => loudError("The clock did not move", e),
  });
}

export function TodayPage() {
  const { session } = useAuth();
  const dayFn = useServerFn(myDay);
  const clockFn = useServerFn(myClock);
  const q = useQuery({
    queryKey: fieldKeys.today,
    queryFn: () => dayFn(),
    enabled: !!session,
    refetchInterval: 5 * 60_000,
  });
  // My clock (owner, Oct 15): fresh every minute; a press re-reads it at once.
  const clockQ = useQuery({
    queryKey: fieldKeys.clock,
    queryFn: () => clockFn(),
    enabled: !!session,
    refetchInterval: 60_000,
  });
  const clock = clockQ.data ?? null;
  // The phone's day, re-checked every minute: the groups flip at midnight without a reload.
  const today = useLocalDay();
  const jobs = q.data ?? [];
  // Today (and anything overdue or already started) first, then the coming days, then undated.
  const now_ = jobs.filter(
    (j) => !!j.field_status || (!!j.scheduled_date && j.scheduled_date <= today),
  );
  const later = jobs.filter((j) => !now_.includes(j) && !!j.scheduled_date);
  const undated = jobs.filter((j) => !now_.includes(j) && !j.scheduled_date);
  const title = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-5 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">My tickets</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
          <Link
            to="/service"
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-2 hover:underline"
          >
            Every stage, on the Service page
          </Link>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label="Refresh"
          title="Refresh"
          disabled={q.isFetching}
          onClick={() => {
            void q.refetch();
            void clockQ.refetch();
          }}
        >
          <RefreshCw className={`h-5 w-5 ${q.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {clockQ.error && (
        <p className="flex items-center gap-2 rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Could not read your clock:{" "}
          {errText(clockQ.error)}
        </p>
      )}
      {clock && <ClockBanner clock={clock} jobs={jobs} />}

      {q.error ? (
        <div className="space-y-2 rounded-lg border border-destructive p-4 text-destructive">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-5 w-5" /> Could not load your tickets
          </p>
          <p className="text-sm">{errText(q.error)}</p>
          <Button variant="outline" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : q.isLoading || !q.data ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your day…
        </p>
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8" />
          Nothing open for you. Check with the office for your next ticket.
        </div>
      ) : (
        <>
          <Group
            title="Today"
            jobs={now_}
            today={today}
            clock={clock}
            empty="Nothing scheduled for today."
          />
          {later.length > 0 && <Group title="Coming up" jobs={later} today={today} clock={clock} />}
          {undated.length > 0 && (
            <Group title="No date yet" jobs={undated} today={today} clock={clock} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The running clock, at the top: "On site at #6014 Bell County · 1 h 20 m" and the next buttons
 * (travelling → On site; on site → Leave site, Complete). Complete opens the close-out, whose
 * Complete clocks out.
 */
function ClockBanner({ clock, jobs }: { clock: MyClock; jobs: TodayJob[] }) {
  // The ticking minutes are this banner's alone: the cards below never re-render for them.
  const now = useTick(30_000);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const ticket = {
    id: clock.service_job_id,
    number: clock.number,
    customer_name: clock.customer_name,
  };
  const press = useClockPress(ticket);
  const openCloseout = () => {
    const j = jobs.find((x) => x.id === clock.service_job_id);
    if (j)
      qc.setQueryData<ServiceJobWithTech>(
        fieldKeys.job(j.id),
        (old) => old ?? seedJobFromToday(j, profile),
      );
    void navigate({ to: "/service", search: { id: clock.service_job_id, closeout: 1 } });
  };
  const onSite = clock.kind === "labor";
  const since = new Date(clock.started_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  // This ticket's pictures still going up, or kept on the phone for signal (owner, Oct 28).
  const pictures = usePictures({ jobId: clock.service_job_id });
  return (
    // Owner, Oct 15: the one control for the running clock, nothing like a ticket card — a
    // coloured panel (amber on the road, green on site) with the state, the elapsed time, what
    // to do next, and the buttons; the ticket's own card below only says "use the clock above".
    <section
      className={`space-y-3 rounded-xl border-2 p-4 ${
        onSite
          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40"
          : "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
      }`}
      aria-label="My clock"
      data-line="clock-banner"
      data-clock={clock.kind}
    >
      <p className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Your clock</span>
        <span
          className={`rounded-full px-2 py-0.5 normal-case ${
            onSite ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
          }`}
        >
          {onSite ? "On site" : "Travelling"} · since {since}
        </span>
      </p>
      <p className="flex items-center gap-2 text-base font-semibold">
        {onSite ? (
          <MapPinCheck className="h-5 w-5 shrink-0" />
        ) : (
          <Truck className="h-5 w-5 shrink-0" />
        )}
        <Link
          to="/service"
          search={{ id: clock.service_job_id }}
          className="underline-offset-2 hover:underline"
        >
          {runningLabel(
            clock,
            new Date(Math.max(now, new Date(clock.started_at).getTime())),
            clock,
          )}
        </Link>
      </p>
      <p className="text-sm text-muted-foreground" data-line="clock-next">
        {onSite
          ? "Leaving for now? Leave site stops the clock and keeps the ticket open to come back to. Finished? Complete opens the close-out."
          : "When you arrive, tap On site — the travel time is logged and the labor clock starts."}
      </p>
      <UploadBadge n={pictures.uploading} />
      <WaitingForSignalLine n={pictures.waitingForSignal} />
      <div className="flex gap-2">
        {!onSite ? (
          <Button
            type="button"
            className="h-14 flex-1 text-lg font-semibold"
            disabled={press.isPending}
            onClick={() => press.mutate("on_site")}
          >
            {press.isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <MapPinCheck className="mr-2 h-5 w-5" />
            )}
            On site
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-14 flex-1 flex-col gap-0 text-base font-semibold"
              disabled={press.isPending}
              onClick={() => press.mutate("leave")}
            >
              <span className="flex items-center">
                {press.isPending ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-5 w-5" />
                )}
                Leave site
              </span>
              <span className="text-xs font-normal text-muted-foreground">not done yet</span>
            </Button>
            <Button
              type="button"
              className="h-14 flex-1 flex-col gap-0 text-base font-semibold"
              disabled={press.isPending}
              onClick={openCloseout}
            >
              <span className="flex items-center">
                <CheckCircle2 className="mr-2 h-5 w-5" />
                Complete
              </span>
              <span className="text-xs font-normal opacity-80">finish the ticket</span>
            </Button>
          </>
        )}
      </div>
      {!onSite && (
        <button
          type="button"
          className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          disabled={press.isPending}
          onClick={() => press.mutate("undo")}
        >
          Started travel by mistake? Cancel it (nothing is logged)
        </button>
      )}
    </section>
  );
}

function Group({
  title,
  jobs,
  today,
  clock,
  empty,
}: {
  title: string;
  jobs: TodayJob[];
  today: string;
  clock: MyClock | null;
  empty?: string | undefined;
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="border-b pb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <span className="ml-2 font-normal normal-case">{jobs.length}</span>
      </h2>
      {jobs.length === 0 && empty ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        jobs.map((j) => <JobCard key={j.id} job={j} today={today} clock={clock} />)
      )}
    </section>
  );
}

function JobCard({
  job: j,
  today,
  clock,
}: {
  job: TodayJob;
  today: string;
  clock: MyClock | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const address = j.site_address || "";
  const mapQuery = address || [j.site_name, j.customer_name].filter(Boolean).join(", ");
  const phone = j.contact_phone || j.account_phone;
  const overdue = !!j.scheduled_date && j.scheduled_date < today;
  // The arrival window (M1), when the office set one.
  const arrival = arrivalLabel(j.arrival_window);
  // The crew question is the close-out's first section (owner, Oct 8); here, an answered card
  // names the crew and "Change" reopens the box.
  const [crewOpen, setCrewOpen] = useState(false);
  // The clock's buttons for this card (tech-clock.ts cardActions; owner, Oct 15).
  const actions = cardActions(clock, j.id);
  const press_ = useClockPress(j);
  // This ticket's pictures still going up, or kept on the phone for signal (owner, Oct 28).
  const pictures = usePictures({ jobId: j.id });

  const press = () => {
    // Owner, Oct 9 (S13): this row IS the ticket row — plant it as the close-out's job so the
    // screen renders at once (job-cache.ts); the loader still re-reads it in the background.
    qc.setQueryData<ServiceJobWithTech>(
      fieldKeys.job(j.id),
      (old) => old ?? seedJobFromToday(j, profile),
    );
    void navigate({ to: "/service", search: { id: j.id, closeout: 1 } });
  };
  const busy = press_.isPending;
  const spin = (Icon: typeof Truck) =>
    busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Icon className="mr-2 h-5 w-5" />;

  return (
    <article className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="space-y-1">
        <Link
          to="/service"
          search={{ id: j.id }}
          className="flex min-h-11 items-center text-lg font-semibold leading-snug underline-offset-2 hover:underline"
        >
          #{j.number} · {j.customer_name}
        </Link>
        {j.scheduled_date && (j.scheduled_date !== today || arrival) && (
          <p
            className={`flex items-center gap-1 text-xs ${overdue ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {dayWithWindow(
              j.scheduled_date === today
                ? "Today"
                : overdue
                  ? `Was due ${shortDay(j.scheduled_date)}`
                  : shortDay(j.scheduled_date),
              // An overdue ticket's window has passed with its day.
              overdue ? null : j.arrival_window,
            )}
          </p>
        )}
      </div>

      {(j.site_name || mapQuery) && (
        <a
          href={mapsUrl(mapQuery)}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-start gap-2 rounded-md py-1 text-sm hover:bg-muted"
        >
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span>
            {j.site_name && <span className="block font-medium">{j.site_name}</span>}
            <span className="text-primary underline underline-offset-2">
              {address || "Open in maps"}
            </span>
          </span>
        </a>
      )}

      {/* What happened here before (owner, Oct 21): one line, a tap opens the ticket with its
          History fold open. Left out when this is the first ticket here — the card stays short. */}
      {j.site_id && <HistoryLink jobId={j.id} whenNone="hide" />}

      {j.description && <p className="text-base">{j.description}</p>}

      {/* M5 (owner, Oct 5): the roof warranty while in force. */}
      {j.warranty_badges?.length > 0 && <WarrantyBadgeList badges={j.warranty_badges} />}

      {j.technician_instructions && (
        <p className="whitespace-pre-line rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
          <span className="font-semibold">Instructions: </span>
          {j.technician_instructions}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {(j.contact_name || phone) && (
          <span className="flex flex-wrap items-center gap-x-2">
            {j.contact_name && <span>{j.contact_name}</span>}
            {phone && (
              <a
                href={`tel:${phone}`}
                className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                <Phone className="h-4 w-4" />
                {phone}
              </a>
            )}
          </span>
        )}
        {j.crew_names.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Users className="h-4 w-4" />
            With {j.crew_names.join(", ")}
          </span>
        ) : j.crew_confirmed_at ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Users className="h-4 w-4" />
            Alone
          </span>
        ) : (
          j.helper_count > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Users className="h-4 w-4" />
              {j.helper_count} helper{j.helper_count > 1 ? "s" : ""}
            </span>
          )
        )}
        {j.crew_confirmed_at && (
          <button
            type="button"
            className="min-h-11 px-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
            aria-expanded={crewOpen}
            onClick={() => setCrewOpen((v) => !v)}
          >
            {crewOpen ? "Done" : "Change"}
          </button>
        )}
      </div>

      {crewOpen && <CrewBox job={j} />}

      <UploadBadge n={pictures.uploading} />
      <WaitingForSignalLine n={pictures.waitingForSignal} />

      {/* The clock's buttons (owner, Oct 15; the Oct 8 one-button card is superseded): Start
          travel / On site while the clock is not on this ticket (a clock on another ticket moves
          here on a press). While it is, the banner at the top is the one control and the card
          only says so (cardActions returns none). */}
      {clock && clock.service_job_id === j.id && (
        <p
          className="flex items-center gap-2 text-sm font-medium text-primary"
          data-line="card-clock"
        >
          <Clock className="h-4 w-4 shrink-0" />
          {clock.kind === "labor" ? "You are on site here" : "You are travelling here"}
          {" · since "}
          {new Date(clock.started_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
          <span className="font-normal text-muted-foreground">— use the clock at the top</span>
        </p>
      )}
      <div className="flex gap-2" data-line="clock-buttons">
        {actions.includes("travel") && (
          <Button
            type="button"
            variant="outline"
            className="h-14 flex-1 text-lg font-semibold"
            disabled={busy}
            onClick={() => press_.mutate("en_route")}
          >
            {spin(Truck)}
            Start travel
          </Button>
        )}
        {actions.includes("on_site") && (
          <Button
            type="button"
            className="h-14 flex-1 text-lg font-semibold"
            disabled={busy}
            onClick={() => press_.mutate("on_site")}
          >
            {spin(MapPinCheck)}
            On site
          </Button>
        )}
      </div>
      {/* Open ticket: the close-out, which saves itself; the tech can leave it and come back
          (photos before, then after) until Complete (the banner's, while the clock is here). */}
      <Button type="button" size="lg" className="h-16 w-full text-xl font-semibold" onClick={press}>
        <ClipboardList className="mr-2 h-6 w-6" />
        Open ticket
      </Button>
    </article>
  );
}
