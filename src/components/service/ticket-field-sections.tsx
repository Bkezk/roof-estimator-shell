/**
 * The field side of a ticket on the office ticket page (docs/service-module-design.md §5.3):
 * the site contact select, and read-only sections for what the technician recorded (repairs
 * with photos, close-out notes and signature, time; time is editable for the office) plus the
 * ticket's timeline with an "Add note" box.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  CheckCircle2,
  Clock,
  History,
  MapPinned,
  Loader2,
  MessageSquare,
  PenLine,
  Phone,
  PhoneCall,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { listContacts } from "@/lib/crm.functions";
import {
  STAGE_LABELS,
  TYPE_LABELS,
  type ServiceJobWithTech,
  type ServiceStage,
  type ServiceType,
} from "@/lib/service.functions";
import { Link } from "@tanstack/react-router";
import { listTechnicians } from "@/lib/auth.functions";
import { AuditHistory } from "@/components/audit-history";
import { insertMention, mentionQuery, suggestPeople } from "@/lib/mentions";
import { historyDay, historyDayText, historySnippet, SITE_HISTORY_LIMIT } from "@/lib/site-history";
import {
  addJobNote,
  listJobEvents,
  listJobPhotos,
  listJobRepairs,
  listSiteHistory,
  listTimeEntries,
  type JobEventRow,
} from "@/lib/service-field.functions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { photoOrdinals } from "@/lib/photo-annotations";
import { Box, PhotoThumb, TimeEntries } from "@/components/service/field-shared";
import { DownloadAllPhotos } from "@/components/service/photo-markup";
import {
  errText,
  fieldKeys,
  loudError,
  useSignedUrl,
  whenShort,
} from "@/components/service/field-utils";

// ---------------------------------------------------------------------------------------------
// Contact select (in the ticket's customer block, under the site)

/**
 * The ticket's site contact: the account's contacts, the site's own first. "" = none. The phone
 * shows beside the name so the office can call from here.
 */
export function ContactSelect({
  accountId,
  siteId,
  value,
  onChange,
  disabled,
}: {
  accountId: string;
  siteId: string | null;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const { session } = useAuth();
  const listFn = useServerFn(listContacts);
  const q = useQuery({
    queryKey: ["contacts", accountId],
    queryFn: () => listFn({ data: { account_id: accountId } }),
    enabled: !!session,
  });
  const all = q.data ?? [];
  const here = (c: (typeof all)[number]) => !!siteId && c.site_ids.includes(siteId);
  const sorted = [...all].sort((a, b) => Number(here(b)) - Number(here(a)));
  const picked = all.find((c) => c.id === value);
  const phoneOf = (c: (typeof all)[number]) => c.mobile || c.office_phone || "";
  // A customer with no contacts at all: one line instead of an empty select (owner, Oct 1).
  if (!q.isLoading && !q.error && all.length === 0 && !value)
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium">Site contact</p>
        <p className="text-xs text-muted-foreground">
          No contacts on this customer yet; add them on the customer's page.
        </p>
      </div>
    );
  return (
    <div className="space-y-1">
      <label htmlFor="ticket-contact" className="text-xs font-medium">
        Site contact
      </label>
      <Select
        value={value || "none"}
        disabled={disabled || q.isLoading}
        onValueChange={(v) => onChange(v === "none" ? "" : v)}
      >
        <SelectTrigger id="ticket-contact" className="bg-background">
          <SelectValue placeholder={q.isLoading ? "Loading contacts…" : "No contact"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No contact</SelectItem>
          {sorted.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
              {phoneOf(c) ? ` · ${phoneOf(c)}` : ""}
              {here(c) ? " (this site)" : c.is_billing ? " (billing)" : ""}
            </SelectItem>
          ))}
          {/* A contact since removed from the account stays readable on an old ticket. */}
          {value && !picked && !q.isLoading && (
            <SelectItem value={value}>Former contact</SelectItem>
          )}
        </SelectContent>
      </Select>
      {q.error && (
        <p className="text-xs text-destructive">Could not load contacts: {errText(q.error)}</p>
      )}
      {!q.isLoading && !q.error && all.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No contacts on this customer yet; add them on the customer's page.
        </p>
      )}
      {picked && phoneOf(picked) && (
        <a
          href={`tel:${phoneOf(picked)}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <Phone className="h-3 w-3" /> {phoneOf(picked)}
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Read-only field sections. Each is collapsible with a one-line summary (owner, Sep 28: the
// ticket page had too much open at once); the open state is remembered per section.

const hoursText = (h: number) => `${Number(h.toFixed(2))} h`;

/**
 * Repairs, close-out, time and timeline of a ticket, below its Materials used. The office's
 * right-hand column (owner, Oct 1) puts Repairs (with the ticket's photos) above Materials, so
 * it renders <TicketRepairs> itself and passes `repairs={false}` here.
 */
export function TicketFieldSections({
  job,
  officeOrAdmin,
  repairs = true,
  canEdit,
}: {
  job: ServiceJobWithTech;
  officeOrAdmin: boolean;
  repairs?: boolean;
  /**
   * The ticket's photos can be marked up; by default the office and the ticket's own
   * technician (the server's rule, savePhotoAnnotations → ownJob).
   */
  canEdit?: boolean;
}) {
  const { profile } = useAuth();
  const markup = canEdit ?? (officeOrAdmin || (!!profile && job.technician_id === profile.id));
  return (
    <>
      {repairs && <RepairsReadOnly jobId={job.id} ticketNumber={job.number} canEdit={markup} />}
      <CloseoutSummary job={job} />
      <TimeSection job={job} officeOrAdmin={officeOrAdmin} />
      <Timeline jobId={job.id} />
      {job.site_id && <EarlierAtSite jobId={job.id} />}
      {/* M6 (owner, Oct 5): every change to the ticket and its time, old → new, who, when.
          Admins and managers only (AuditHistory renders nothing for anyone else). */}
      <AuditHistory entity="ticket" entityId={job.id} className="rounded-lg border px-4 py-3" />
    </>
  );
}

/** Time, collapsed by default; the header shows travel + labor hours. */
function TimeSection({ job, officeOrAdmin }: { job: ServiceJobWithTech; officeOrAdmin: boolean }) {
  const { session } = useAuth();
  const listFn = useServerFn(listTimeEntries);
  // The same query (and key) TimeEntries reads, so the list below shares the cache.
  const q = useQuery({
    queryKey: fieldKeys.time(job.id),
    queryFn: () => listFn({ data: { id: job.id } }),
    enabled: !!session,
  });
  const rows = q.data ?? [];
  const total = rows
    .filter((r) => r.kind === "travel" || r.kind === "labor")
    .reduce((s, r) => s + Number(r.hours), 0);
  const summary = q.error ? (
    <span className="text-destructive">could not load</span>
  ) : q.isLoading ? null : rows.length === 0 ? (
    "no time yet"
  ) : (
    hoursText(total)
  );
  return (
    <Box
      title="Time"
      icon={Clock}
      collapsible
      defaultOpen={false}
      storageKey="time"
      summary={summary}
    >
      <TimeEntries
        jobId={job.id}
        editable={officeOrAdmin}
        defaultHelpers={job.helper_count}
        compact
      />
    </Box>
  );
}

/**
 * The Repairs section on its own (repairs, their photos and the ticket's other photos). A photo
 * opens in the lightbox with its marks; `canEdit` offers Mark up there (owner, Oct 1).
 */
export function TicketRepairs({
  jobId,
  ticketNumber,
  canEdit = false,
}: {
  jobId: string;
  ticketNumber?: number | string | null;
  canEdit?: boolean;
}) {
  return <RepairsReadOnly jobId={jobId} ticketNumber={ticketNumber} canEdit={canEdit} />;
}

function RepairsReadOnly({
  jobId,
  ticketNumber,
  canEdit,
}: {
  jobId: string;
  ticketNumber?: number | string | null | undefined;
  canEdit: boolean;
}) {
  const { session } = useAuth();
  const repairsFn = useServerFn(listJobRepairs);
  const photosFn = useServerFn(listJobPhotos);
  const repairs = useQuery({
    queryKey: fieldKeys.repairs(jobId),
    queryFn: () => repairsFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const photos = useQuery({
    queryKey: fieldKeys.photos(jobId),
    queryFn: () => photosFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const rows = repairs.data ?? [];
  const pics = (photos.data ?? []).filter((p) => p.role !== "signature");
  const loose = pics.filter((p) => !p.repair_id || !rows.some((r) => r.id === p.repair_id));
  const ord = photoOrdinals(pics);
  const thumb = (p: (typeof pics)[number]) => (
    <PhotoThumb
      key={p.id}
      photo={p}
      size="sm"
      canAnnotate={canEdit}
      ticketNumber={ticketNumber}
      ordinal={ord.get(p.id)}
    />
  );
  // Nothing recorded (and nothing wrong): no section at all. Also nothing while loading, so a
  // ticket without repairs does not flash an empty box.
  if (!repairs.error && repairs.isLoading) return null;
  if (!repairs.error && !photos.error && rows.length === 0 && loose.length === 0) return null;
  const summary = repairs.error ? (
    <span className="text-destructive">could not load</span>
  ) : rows.length > 0 ? (
    `${rows.length} ${rows.length === 1 ? "repair" : "repairs"}`
  ) : (
    `${loose.length} ${loose.length === 1 ? "photo" : "photos"}`
  );
  return (
    <Box title="Repairs" icon={Wrench} collapsible storageKey="repairs" summary={summary}>
      {repairs.error ? (
        <p className="text-sm text-destructive">
          Could not load the repairs: {errText(repairs.error)}
        </p>
      ) : repairs.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No repairs recorded yet. The technician adds them at close-out.
        </p>
      ) : (
        <ol className="space-y-3">
          {rows.map((r) => {
            const mine = pics.filter((p) => p.repair_id === r.id);
            return (
              <li key={r.id} className="space-y-1.5 rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {r.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {Number(r.quantity)} {r.unit}
                  </span>
                </p>
                {r.problem_text && (
                  <p className="whitespace-pre-line">
                    <span className="text-muted-foreground">Problem: </span>
                    {r.problem_text}
                  </p>
                )}
                {r.resolution_text && (
                  <p className="whitespace-pre-line">
                    <span className="text-muted-foreground">Work completed: </span>
                    {r.resolution_text}
                  </p>
                )}
                {mine.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">{mine.map(thumb)}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {photos.error && (
        <p className="text-sm text-destructive">
          Could not load the photos: {errText(photos.error)}
        </p>
      )}
      {loose.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Other photos</p>
          <div className="flex flex-wrap gap-2">{loose.map(thumb)}</div>
        </div>
      )}
      {pics.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <DownloadAllPhotos photos={pics} ticketNumber={ticketNumber} />
          <span className="text-xs text-muted-foreground">
            One file per photo, with its marks drawn in.
          </span>
        </div>
      )}
    </Box>
  );
}

function CloseoutSummary({ job }: { job: ServiceJobWithTech }) {
  const sig = useSignedUrl(job.signature_path);
  const any =
    job.closing_notes ||
    job.checked_in_with ||
    job.checked_out_with ||
    job.recommend_new_roof ||
    job.signature_path ||
    job.completed_at;
  // Owner, Oct 5: a ticket the office set Invoiced / Closed from the stage picker, with no
  // close-out behind it, says so instead of "not closed out yet".
  const officeStage = ["authorized", "invoiced", "closed"].includes(job.stage);
  const summary = job.completed_at
    ? `Done ${whenShort(job.completed_at)}`
    : any
      ? "in progress"
      : officeStage
        ? `${STAGE_LABELS[job.stage as ServiceStage]} by the office — no close-out`
        : "not closed out yet";
  return (
    <Box
      title="Close-out"
      icon={CheckCircle2}
      collapsible
      defaultOpen={!!any}
      storageKey="closeout"
      summary={summary}
    >
      {!any ? (
        <p className="text-sm text-muted-foreground">
          {officeStage
            ? `The office set this ticket ${STAGE_LABELS[job.stage as ServiceStage]} from the stage picker; nobody has closed it out.`
            : "Not closed out yet."}
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          {job.completed_at && (
            <p>
              <span className="text-muted-foreground">Done: </span>
              {whenShort(job.completed_at)}
            </p>
          )}
          {job.recommend_new_roof && (
            <p className="font-medium text-amber-700 dark:text-amber-400">
              The technician recommends a new roof.
            </p>
          )}
          {(job.checked_in_with || job.checked_out_with) && (
            <p>
              {job.checked_in_with && (
                <>
                  <span className="text-muted-foreground">Checked in with </span>
                  {job.checked_in_with}
                </>
              )}
              {job.checked_in_with && job.checked_out_with ? " · " : ""}
              {job.checked_out_with && (
                <>
                  <span className="text-muted-foreground">Checked out with </span>
                  {job.checked_out_with}
                </>
              )}
            </p>
          )}
          {job.closing_notes && (
            <p className="whitespace-pre-line rounded-md bg-muted/40 px-3 py-2">
              {job.closing_notes}
            </p>
          )}
          {job.signature_path && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-muted-foreground">
                <PenLine className="h-3.5 w-3.5" />
                Signed{job.signed_by ? ` by ${job.signed_by}` : ""}
                {job.signed_at ? ` · ${whenShort(job.signed_at)}` : ""}
              </p>
              <div className="inline-block max-w-full overflow-hidden rounded-md border bg-white p-1">
                {sig.data ? (
                  <img src={sig.data} alt="Customer's signature" className="max-h-32" />
                ) : sig.error ? (
                  <p className="p-2 text-xs text-destructive">
                    Could not show the signature: {errText(sig.error)}
                  </p>
                ) : (
                  <Loader2 className="m-3 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Box>
  );
}

const FIELD_LABEL: Record<string, string> = { en_route: "En route", on_site: "On site" };
/** A logged contact (crm_contact_log → timeline, meta.method). */
const CONTACT_TEXT: Record<string, string> = {
  called: "Called the customer",
  texted: "Texted the customer",
  emailed: "Emailed the customer",
  visited: "Visited the customer",
  other: "Contacted the customer",
};

function eventText(e: JobEventRow): { icon: typeof Wrench; text: string } {
  const meta = (e.meta ?? {}) as { role?: string; method?: string };
  switch (e.kind) {
    case "stage":
      return {
        icon: CheckCircle2,
        text: `Stage: ${STAGE_LABELS[e.stage as ServiceStage] ?? e.stage ?? "changed"}`,
      };
    case "field":
      if (e.note === "undo") return { icon: Truck, text: "Undid the last step" };
      return {
        icon: Truck,
        text: FIELD_LABEL[e.field_status ?? ""] ?? `Field: ${e.field_status ?? "changed"}`,
      };
    case "note":
      return { icon: MessageSquare, text: e.note ?? "" };
    case "contact": {
      const what = CONTACT_TEXT[meta.method ?? ""] ?? "Contacted the customer";
      // The note (if any) reads on its own line (the row renders pre-line).
      return { icon: PhoneCall, text: e.note ? `${what}\n${e.note}` : what };
    }
    case "photo":
      return {
        icon: Camera,
        text: `${meta.role === "before" ? "Before photo" : meta.role === "after" ? "After photo" : "Photo"} added`,
      };
    case "signature":
      return { icon: PenLine, text: "Customer signed" };
    case "edit":
      // "Who is on this job" answers (setJobCrew) and other recorded edits.
      return { icon: /^Crew:/.test(e.note ?? "") ? Users : History, text: e.note ?? "Edited" };
    default:
      return { icon: History, text: [e.kind, e.note].filter(Boolean).join(": ") };
  }
}

/** An event as one line (the first line of its text), for the Timeline header. */
function eventSummary(e: JobEventRow) {
  return eventText(e).text.split("\n")[0] || "Note";
}

function Timeline({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listJobEvents);
  const noteFn = useServerFn(addJobNote);
  const q = useQuery({
    queryKey: fieldKeys.events(jobId),
    queryFn: () => listFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const [note, setNote] = useState("");
  // @mentions (M3, owner Oct 5): "@" opens a short list of people; picking one writes the name.
  const peopleFn = useServerFn(listTechnicians);
  const peopleQ = useQuery({
    queryKey: ["technician-options"],
    queryFn: () => peopleFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const suggestions = mention ? suggestPeople(peopleQ.data ?? [], mention.query) : [];
  const typed = (value: string, caret: number) => {
    setNote(value);
    setMention(mentionQuery(value, caret));
  };
  const pick = (name: string) => {
    const box = boxRef.current;
    if (!mention || !box) return;
    const next = insertMention(note, mention.at, box.selectionStart ?? note.length, name);
    setNote(next.text);
    setMention(null);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(next.caret, next.caret);
    });
  };
  const add = useMutation({
    mutationFn: () => noteFn({ data: { id: jobId, note: note.trim() } }),
    onSuccess: (r) => {
      setNote("");
      setMention(null);
      toast.success(
        r.mentioned > 0
          ? `Note added — told ${r.mentioned} ${r.mentioned === 1 ? "person" : "people"}`
          : "Note added",
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
    },
    onError: (e) => {
      // "Note added, but the mentions were not sent: …": the note is in, so it leaves the box.
      if (errText(e).startsWith("Note added")) {
        setNote("");
        setMention(null);
        void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
        toast.error(errText(e), { duration: 12_000 });
      } else loudError("Could not add the note", e);
    },
  });
  const rows = q.data ?? [];
  // The server returns newest first.
  const latest = rows[0];
  const summary = q.error ? (
    <span className="text-destructive">could not load</span>
  ) : latest ? (
    `${eventSummary(latest)} · ${whenShort(latest.at)}`
  ) : q.isLoading ? null : (
    "nothing yet"
  );
  return (
    <Box
      title="Timeline"
      icon={History}
      collapsible
      defaultOpen={false}
      storageKey="timeline"
      summary={summary}
    >
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) add.mutate();
        }}
      >
        <div className="relative">
          <Textarea
            ref={boxRef}
            rows={2}
            placeholder="Add a note to this ticket… type @ to tell someone"
            value={note}
            maxLength={5000}
            onChange={(e) =>
              typed(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }
            onKeyDown={(e) => {
              if (e.key === "Escape") setMention(null);
              if ((e.key === "Enter" || e.key === "Tab") && suggestions[0]) {
                e.preventDefault();
                pick(suggestions[0].name);
              }
            }}
            onBlur={() => setTimeout(() => setMention(null), 150)}
          />
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="People to mention"
              className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border bg-popover text-sm shadow-md"
            >
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(p.name);
                    }}
                  >
                    @{p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="submit" size="sm" disabled={!note.trim() || add.isPending}>
          {add.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Add note
        </Button>
      </form>
      {q.error ? (
        <p className="text-sm text-destructive">Could not load the timeline: {errText(q.error)}</p>
      ) : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((e) => {
            const { icon: Icon, text } = eventText(e);
            return (
              <li key={e.id} className="flex gap-2 text-sm">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p
                    className={
                      e.kind === "note" || e.kind === "contact" ? "whitespace-pre-line" : ""
                    }
                  >
                    {text}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {whenShort(e.at)}
                    {e.by_name ? ` · ${e.by_name}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------------------------
// Earlier at this site (service study M4, owner Oct 5)

/**
 * The last tickets at the same site, newest first: number (opens it), day, type, stage, who,
 * and the first line of what was found. Collapsed by default; the header says how many.
 */
function EarlierAtSite({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listSiteHistory);
  const q = useQuery({
    queryKey: ["site-history", jobId],
    queryFn: () => listFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const rows = q.data ?? [];
  const summary = q.error ? (
    <span className="text-destructive">could not load</span>
  ) : q.isLoading ? null : rows.length === 0 ? (
    "none"
  ) : (
    `${rows.length}${rows.length === SITE_HISTORY_LIMIT ? "+" : ""} earlier · last ${historyDayText(historyDay(rows[0]!))}`
  );
  return (
    <Box
      title="Earlier at this site"
      icon={MapPinned}
      collapsible
      defaultOpen={false}
      storageKey="earlier"
      summary={summary}
    >
      {q.error ? (
        <p className="text-sm text-destructive">
          Could not load earlier tickets: {errText(q.error)}
        </p>
      ) : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No earlier tickets at this site.</p>
      ) : (
        <ol className="divide-y">
          {rows.map((r) => {
            const snippet = historySnippet(r);
            return (
              <li key={r.id} className="py-2 text-sm">
                <Link
                  to="/service"
                  search={{ id: r.id }}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  #{r.number}
                </Link>
                <span className="text-muted-foreground">
                  {" · "}
                  {historyDayText(historyDay(r))} ·{" "}
                  {TYPE_LABELS[r.service_type as ServiceType] ?? "Other"} ·{" "}
                  {STAGE_LABELS[r.stage as ServiceStage] ?? r.stage}
                  {r.technician_name ? ` · ${r.technician_name}` : ""}
                </span>
                {snippet && <p className="mt-0.5 text-muted-foreground">“{snippet}”</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Box>
  );
}
