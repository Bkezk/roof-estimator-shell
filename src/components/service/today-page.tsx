/**
 * The technician's day on the phone (docs/service-module-design.md §5.3): their open tickets,
 * today's first, each with ONE big button for the next step only: En route → On site → Done.
 * En route and On site go straight to setFieldStatus (optimistic; the server stamps the time
 * and writes the travel entry); Done opens the close-out, whose Complete stamps the labor and
 * sets the ticket Done. Office users see every open ticket here (myDay).
 *
 * Once a ticket is started, the card asks "Who is on this job with you?" (crew-box.tsx; owner,
 * Sep 30) until it is answered; after that the card names the crew and "Change" reopens it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Truck,
  Users,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { myDay, setFieldStatus, type TodayJob } from "@/lib/service-field.functions";
import { Button } from "@/components/ui/button";
import { CrewBox } from "@/components/service/crew-box";
import { crewQuestionPending } from "@/lib/service-crew";
import { arrivalLabel, dayWithWindow } from "@/lib/arrival-window";
import { WarrantyBadgeList } from "@/components/crm/site-warranties";
import {
  clock,
  errText,
  fieldKeys,
  localYmd,
  loudError,
  shortDay,
} from "@/components/service/field-utils";

type Step = "en_route" | "on_site" | "undo";

/** The next step of a ticket, from its field status. */
function nextStep(j: TodayJob): { label: string; to: "en_route" | "on_site" | "done" } {
  if (j.field_status === "on_site") return { label: "Done", to: "done" };
  if (j.field_status === "en_route") return { label: "On site", to: "on_site" };
  return { label: "En route", to: "en_route" };
}

/** What the server will do, applied at once so the button answers the tap. */
function predict(j: TodayJob, to: Step): TodayJob {
  const now = new Date().toISOString();
  if (to === "en_route")
    return j.field_status ? j : { ...j, field_status: "en_route", en_route_at: now };
  if (to === "on_site") return { ...j, field_status: "on_site", on_site_at: now };
  if (j.field_status === "on_site")
    return { ...j, field_status: j.en_route_at ? "en_route" : null, on_site_at: null };
  if (j.field_status === "en_route") return { ...j, field_status: null, en_route_at: null };
  return j;
}

const mapsUrl = (q: string) => `https://maps.google.com/?q=${encodeURIComponent(q)}`;

export function TodayPage() {
  const { session } = useAuth();
  const dayFn = useServerFn(myDay);
  const q = useQuery({
    queryKey: fieldKeys.today,
    queryFn: () => dayFn(),
    enabled: !!session,
    refetchInterval: 5 * 60_000,
  });
  const today = localYmd();
  const jobs = q.data ?? [];
  // Today (and anything overdue or already started) first, then the coming days, then undated.
  const now = jobs.filter(
    (j) => !!j.field_status || (!!j.scheduled_date && j.scheduled_date <= today),
  );
  const later = jobs.filter((j) => !now.includes(j) && !!j.scheduled_date);
  const undated = jobs.filter((j) => !now.includes(j) && !j.scheduled_date);
  const title = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-5 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Today · {title}</h1>
          <Link to="/service" className="text-sm text-primary underline-offset-2 hover:underline">
            All my tickets
          </Link>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label="Refresh"
          title="Refresh"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className={`h-5 w-5 ${q.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

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
          <Group title="Today" jobs={now} today={today} empty="Nothing scheduled for today." />
          {later.length > 0 && <Group title="Coming up" jobs={later} today={today} />}
          {undated.length > 0 && <Group title="No date yet" jobs={undated} today={today} />}
        </>
      )}
    </div>
  );
}

function Group({
  title,
  jobs,
  today,
  empty,
}: {
  title: string;
  jobs: TodayJob[];
  today: string;
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
        jobs.map((j) => <JobCard key={j.id} job={j} today={today} />)
      )}
    </section>
  );
}

function JobCard({ job: j, today }: { job: TodayJob; today: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const statusFn = useServerFn(setFieldStatus);
  const step = useMutation({
    // The phone's own calendar day: the server stamps time entries with it (not UTC's day).
    mutationFn: (to: Step) => statusFn({ data: { id: j.id, to, day: localYmd() } }),
    onMutate: async (to) => {
      await qc.cancelQueries({ queryKey: fieldKeys.today });
      const prev = qc.getQueryData<TodayJob[]>(fieldKeys.today);
      qc.setQueryData<TodayJob[]>(fieldKeys.today, (old) =>
        old?.map((x) => (x.id === j.id ? predict(x, to) : x)),
      );
      return { prev };
    },
    onError: (e, to, ctx) => {
      if (ctx?.prev) qc.setQueryData(fieldKeys.today, ctx.prev);
      const what = to === "undo" ? "Undo" : to === "en_route" ? "En route" : "On site";
      loudError(`${what} did not save. Check your signal and tap again`, e);
    },
    onSuccess: (row) => {
      qc.setQueryData<TodayJob[]>(fieldKeys.today, (old) =>
        old?.map((x) => (x.id === row.id ? { ...x, ...row } : x)),
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.job(row.id) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(row.id) });
      void qc.invalidateQueries({ queryKey: fieldKeys.time(row.id) });
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
  });

  const next = nextStep(j);
  const address = j.site_address || "";
  const mapQuery = address || [j.site_name, j.customer_name].filter(Boolean).join(", ");
  const phone = j.contact_phone || j.account_phone;
  const stamps = [
    j.en_route_at ? `En route ${clock(j.en_route_at)}` : null,
    j.on_site_at ? `On site ${clock(j.on_site_at)}` : null,
  ].filter(Boolean);
  const overdue = !!j.scheduled_date && j.scheduled_date < today;
  // The arrival window (M1), when the office set one.
  const arrival = arrivalLabel(j.arrival_window);
  // Started and not yet answered: the crew question shows on the card.
  const askCrew = !!j.field_status && crewQuestionPending(j);
  // Once asked, the box stays open on this card (ticking a second tech after the first
  // answer saved) until the tech closes it with "Done".
  const [crewOpen, setCrewOpen] = useState(false);
  useEffect(() => {
    if (askCrew) setCrewOpen(true);
  }, [askCrew]);

  const press = () => {
    if (step.isPending) return;
    if (next.to === "done") {
      void navigate({ to: "/service", search: { id: j.id, closeout: 1 } });
      return;
    }
    step.mutate(next.to);
  };

  return (
    <article className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="space-y-1">
        <Link
          to="/service"
          search={{ id: j.id }}
          className="block text-lg font-semibold leading-snug underline-offset-2 hover:underline"
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
          className="flex items-start gap-2 rounded-md py-1 text-sm hover:bg-muted"
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
                className="inline-flex min-h-9 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
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
            className="min-h-9 px-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
            aria-expanded={crewOpen}
            onClick={() => setCrewOpen((v) => !v)}
          >
            {crewOpen ? "Done" : "Change"}
          </button>
        )}
      </div>

      {(askCrew || crewOpen) && <CrewBox job={j} />}

      <Button
        size="lg"
        className="h-16 w-full text-xl font-semibold"
        disabled={step.isPending}
        onClick={press}
      >
        {step.isPending ? (
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        ) : next.to === "en_route" ? (
          <Truck className="mr-2 h-6 w-6" />
        ) : next.to === "on_site" ? (
          <Navigation className="mr-2 h-6 w-6" />
        ) : (
          <CheckCircle2 className="mr-2 h-6 w-6" />
        )}
        {next.label}
      </Button>

      {(stamps.length > 0 || j.field_status) && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{stamps.join(" · ")}</span>
          {j.field_status && (
            <button
              type="button"
              className="min-h-9 px-2 font-medium text-foreground underline underline-offset-2 disabled:opacity-50"
              disabled={step.isPending}
              onClick={() => step.mutate("undo")}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </article>
  );
}
