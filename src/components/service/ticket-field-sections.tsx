/**
 * The field side of a ticket on the office ticket page (docs/service-module-design.md §5.3):
 * the site contact select, and read-only sections for what the technician recorded (repairs
 * with photos, close-out notes and signature, time; time is editable for the office). The
 * ticket's activity stream (events, contacts, notes) is the form's Activity block since Oct 27
 * (ticket-activity.tsx). The office adds pictures to the ticket from the Photos & repairs fold
 * too (owner, Oct 26), not only through the technician's workflow.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  Hammer,
  ImagePlus,
  Loader2,
  PenLine,
  Phone,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import { listContacts } from "@/lib/crm.functions";
import { STAGE_LABELS, type ServiceJobWithTech, type ServiceStage } from "@/lib/service.functions";
import {
  clockOnJob,
  deleteJobPhoto,
  listJobPhotos,
  listJobRepairs,
  listTimeEntries,
  type JobPhotoRow,
} from "@/lib/service-field.functions";
import { elapsedLabel } from "@/lib/tech-clock";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { photoOrdinals } from "@/lib/photo-annotations";
import { Box, PhotoThumb, TimeEntries } from "@/components/service/field-shared";
import { DownloadAllPhotos } from "@/components/service/photo-markup";
import {
  dragHasFiles,
  errText,
  fieldKeys,
  loudError,
  takePickedFiles,
  useSignedUrl,
  whenShort,
} from "@/components/service/field-utils";
import { useTicketPictureUpload } from "@/components/service/ticket-picture-upload";
import {
  closeoutInfo,
  hoursText,
  readWorkTab,
  WORK_TAB_KEY,
  workSummary,
  type WorkTab,
} from "@/components/service/ticket-work";

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
        <p className="text-xs font-medium">Property contact</p>
        <p className="text-xs text-muted-foreground">
          No contacts on this customer yet; add them on the customer's page.
        </p>
      </div>
    );
  return (
    <div className="space-y-1">
      <label htmlFor="ticket-contact" className="text-xs font-medium">
        Property contact
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
              {here(c) ? " (this property)" : c.is_billing ? " (billing)" : ""}
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
      {/* Owner, Oct 27 (a shorter column): Close-out, Time and the Activity log are three tabs
          of ONE fold, "Work". The managers' change log (AuditHistory) moved to the page's
          History heading at the bottom of the column. */}
      <WorkFold
        job={job}
        officeOrAdmin={officeOrAdmin}
        review={managesTickets(profile) && (job.stage === "done" || job.stage === "authorized")}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Work: Close-out · Time, one fold with two tabs (owner, Oct 27)

function initialWorkTab(): WorkTab {
  try {
    return readWorkTab(window.localStorage.getItem(WORK_TAB_KEY));
  } catch {
    return "closeout"; // no window (SSR), or storage blocked
  }
}
function rememberWorkTab(tab: WorkTab) {
  try {
    window.localStorage.setItem(WORK_TAB_KEY, tab);
  } catch {
    // Storage blocked (private mode, blocked site data): the tab still switches this visit.
  }
}

/** The time entries (the same key TimeEntries reads, so the list shares the cache). */
function useTimeRows(jobId: string) {
  const { session } = useAuth();
  const listFn = useServerFn(listTimeEntries);
  return useQuery({
    queryKey: fieldKeys.time(jobId),
    queryFn: () => listFn({ data: { id: jobId } }),
    enabled: !!session,
  });
}

/**
 * "Work": one collapsible fold (remembered as "work"; a manager reviewing a Done / Authorized
 * ticket, or a ticket with a close-out, finds it open the first time) with two tabs — Close-out
 * and Time — each the body its own fold had until Oct 27. The Activity log tab it had that
 * morning is the form's Activity block now (ticket-activity.tsx). The last tab is remembered per
 * device. Arriving for the History (FoldAllContext) folds it like every other self-managed Box.
 */
function WorkFold({
  job,
  officeOrAdmin,
  review,
}: {
  job: ServiceJobWithTech;
  officeOrAdmin: boolean;
  /** A manager reviewing a Done / Authorized ticket (Time's review mode: open by default). */
  review: boolean;
}) {
  const time = useTimeRows(job.id);
  const closeout = closeoutInfo(job);
  const [tab, setTab] = useState<WorkTab>(initialWorkTab);
  const hours = (time.data ?? []).reduce((s, r) => s + Number(r.hours), 0);
  const summary = time.error ? (
    <span className="text-destructive">could not load</span>
  ) : time.isLoading ? null : (
    workSummary({ closeout: closeout.line, hours })
  );
  const tabIcon = "mr-1 h-4 w-4";
  return (
    <Box
      title="Work"
      icon={Hammer}
      collapsible
      defaultOpen={review || closeout.any}
      storageKey="work"
      summary={summary}
    >
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const t = readWorkTab(v);
          setTab(t);
          rememberWorkTab(t);
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-2" aria-label="Work">
          <TabsTrigger value="closeout" className="min-h-9">
            <CheckCircle2 className={tabIcon} aria-hidden /> Close-out
          </TabsTrigger>
          <TabsTrigger value="time" className="min-h-9">
            <Clock className={tabIcon} aria-hidden /> Time
          </TabsTrigger>
        </TabsList>
        <TabsContent value="closeout" className="mt-3">
          <CloseoutBody job={job} />
        </TabsContent>
        <TabsContent value="time" className="mt-3">
          <TimeBody job={job} officeOrAdmin={officeOrAdmin} rows={time} />
        </TabsContent>
      </Tabs>
    </Box>
  );
}

/**
 * The clock running on this ticket (owner, Oct 15; clockOnJob — the office reads every clock):
 * "Trace Floyd is on site here · 1 h 20 m (since 9:05 AM)". One line in the ticket header, or
 * nothing. A read that fails says so in small print; it never blocks the page.
 */
export function JobClockLine({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const fn = useServerFn(clockOnJob);
  const q = useQuery({
    queryKey: fieldKeys.jobClock(jobId),
    queryFn: () => fn({ data: { id: jobId } }),
    enabled: !!session,
    refetchInterval: 60_000,
  });
  if (q.error)
    return (
      <p className="text-xs text-destructive" data-line="job-clock">
        Could not read the clock on this ticket: {errText(q.error)}
      </p>
    );
  const c = q.data;
  if (!c) return null;
  const since = new Date(c.started_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium" data-line="job-clock">
      <Clock className="h-4 w-4 shrink-0 text-primary" />
      {c.technician_name} is {c.kind === "labor" ? "on site here" : "travelling here"} ·{" "}
      {elapsedLabel(c.started_at, new Date())} (since {since})
    </p>
  );
}

/** The Work fold's Time tab: travel + labor hours on one line, then the entries (editable for the office). */
function TimeBody({
  job,
  officeOrAdmin,
  rows: q,
}: {
  job: ServiceJobWithTech;
  officeOrAdmin: boolean;
  rows: ReturnType<typeof useTimeRows>;
}) {
  const rows = q.data ?? [];
  const hoursOf = (kind: string) =>
    rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.hours), 0);
  return (
    <div className="space-y-3">
      {q.error ? (
        <p className="text-sm text-destructive">Could not load the time: {errText(q.error)}</p>
      ) : !q.isLoading && rows.length > 0 ? (
        <p className="text-sm text-muted-foreground" data-line="time-hours">
          Travel {hoursText(hoursOf("travel"))} · Labor {hoursText(hoursOf("labor"))}
        </p>
      ) : null}
      <TimeEntries
        jobId={job.id}
        editable={officeOrAdmin}
        defaultHelpers={job.helper_count}
        compact
      />
    </div>
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
  const qc = useQueryClient();
  const repairsFn = useServerFn(listJobRepairs);
  const photosFn = useServerFn(listJobPhotos);
  const deletePhotoFn = useServerFn(deleteJobPhoto);
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
  // Owner, Oct 26: the office adds pictures to a ticket from its page, not only through the
  // technician's close-out — loose "other" photos (ticket-picture-upload.ts; the Inspection
  // fold's rows use the same hook with an item_key).
  const pictures = useTicketPictureUpload(jobId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // The office removes a picture it added by mistake (the thumb's X asks first; the field flow's
  // own delete). The server fn checks the ticket is theirs to touch.
  const delPhoto = useMutation({
    mutationFn: (id: string) => deletePhotoFn({ data: { id, service_job_id: jobId } }),
    onSuccess: (_r, id) => {
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
        old?.filter((p) => p.id !== id),
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(jobId) });
    },
    onError: (e) => loudError("Could not delete the photo", e),
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
      onDelete={canEdit ? () => delPhoto.mutate(p.id) : undefined}
      deleting={delPhoto.isPending && delPhoto.variables === p.id}
    />
  );
  // Nothing recorded (and nothing wrong): no section at all for a reader. Also nothing while
  // loading, so a ticket without repairs does not flash an empty box. The office (`canEdit`)
  // always gets the fold: it adds the ticket's first pictures here (owner, Oct 26).
  if (!canEdit && !repairs.error && repairs.isLoading) return null;
  if (!canEdit && !repairs.error && !photos.error && rows.length === 0 && loose.length === 0)
    return null;
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  const summary = repairs.error ? (
    <span className="text-destructive">could not load</span>
  ) : rows.length > 0 && pics.length > 0 ? (
    `${count(rows.length, "repair")} · ${count(pics.length, "photo")}`
  ) : rows.length > 0 ? (
    count(rows.length, "repair")
  ) : pics.length > 0 ? (
    count(pics.length, "photo")
  ) : repairs.isLoading || photos.isLoading ? (
    "loading…"
  ) : (
    "none yet"
  );
  const title = pics.length > 0 || canEdit ? "Photos & repairs" : "Repairs";
  const addPictures = canEdit && (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-label="Add pictures"
        onChange={(e) => pictures.add(takePickedFiles(e.target))}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pictures.uploading}
        onClick={() => fileRef.current?.click()}
      >
        {pictures.uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ImagePlus className="h-4 w-4" aria-hidden />
        )}
        Add pictures
      </Button>
      <span className="text-xs text-muted-foreground">
        {pictures.progressText ?? "or drop pictures here"}
      </span>
    </div>
  );
  // Drag-and-drop onto the fold's photo area (files only: a thumb dragged OUT to the desktop
  // also passes over this box and must not count).
  const dropProps = canEdit
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!dragHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!dragHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          setDragOver(false);
          pictures.add(e.dataTransfer.files);
        },
      }
    : {};
  return (
    <Box title={title} icon={Wrench} collapsible storageKey="repairs" summary={summary}>
      <div
        {...dropProps}
        className={`space-y-3 rounded-md ${
          dragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
        }`}
      >
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
        {loose.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Other photos</p>
            <div className="flex flex-wrap gap-2">{loose.map(thumb)}</div>
          </div>
        ) : (
          canEdit &&
          !photos.isLoading &&
          !photos.error &&
          pics.length === 0 && <p className="text-sm text-muted-foreground">No pictures yet</p>
        )}
        {addPictures}
        {pics.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <DownloadAllPhotos photos={pics} ticketNumber={ticketNumber} />
            <span className="text-xs text-muted-foreground">
              One file per photo, with its marks drawn in.
            </span>
          </div>
        )}
      </div>
    </Box>
  );
}

/** The Work fold's Close-out tab: what the technician recorded at the end, or why there is nothing. */
function CloseoutBody({ job }: { job: ServiceJobWithTech }) {
  const sig = useSignedUrl(job.signature_path);
  const { any, officeStage } = closeoutInfo(job);
  return (
    <div className="space-y-3" data-tab="closeout">
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
    </div>
  );
}
