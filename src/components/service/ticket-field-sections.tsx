/**
 * The field side of a ticket on the office ticket page (docs/service-module-design.md §5.3):
 * the site contact select, and read-only sections for what the technician recorded (repairs
 * with photos, close-out notes and signature, time; time is editable for the office) plus the
 * ticket's timeline with an "Add note" box. The office adds pictures to the ticket from the
 * Photos & repairs fold too (owner, Oct 26), not only through the technician's workflow.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  CheckCircle2,
  Clock,
  History,
  ImagePlus,
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
import { managesTickets } from "@/lib/access";
import { listContacts } from "@/lib/crm.functions";
import { STAGE_LABELS, type ServiceJobWithTech, type ServiceStage } from "@/lib/service.functions";
import { AuditHistory } from "@/components/audit-history";
import { toldSuffix } from "@/lib/mentions";
import {
  addJobNote,
  clockOnJob,
  deleteJobPhoto,
  listJobEvents,
  listJobPhotos,
  listJobRepairs,
  listTimeEntries,
  registerJobPhoto,
  type JobEventRow,
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
import { MENTION_HINT, MentionTextarea } from "@/components/mention-textarea";
import { photoOrdinals } from "@/lib/photo-annotations";
import { Box, PhotoThumb, TimeEntries } from "@/components/service/field-shared";
import { DownloadAllPhotos } from "@/components/service/photo-markup";
import {
  dragHasFiles,
  errText,
  fieldKeys,
  imageFiles,
  loudError,
  removeFromServiceBucket,
  shrinkPhoto,
  uploadPlan,
  uploadToServiceBucket,
  uploadingLabel,
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
      <TimeSection
        job={job}
        officeOrAdmin={officeOrAdmin}
        review={managesTickets(profile) && (job.stage === "done" || job.stage === "authorized")}
      />
      <Timeline jobId={job.id} />
      {/* M6 (owner, Oct 5): every change to the ticket and its time, old → new, who, when.
          Admins and managers only (AuditHistory renders nothing for anyone else). */}
      <AuditHistory entity="ticket" entityId={job.id} className="rounded-lg border px-4 py-3" />
    </>
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

/** Time, collapsed by default; the header shows travel + labor hours. */
function TimeSection({
  job,
  officeOrAdmin,
  review,
}: {
  job: ServiceJobWithTech;
  officeOrAdmin: boolean;
  /** A manager reviewing a Done / Authorized ticket: open, remembered apart (follow-up 6). */
  review: boolean;
}) {
  const { session } = useAuth();
  const listFn = useServerFn(listTimeEntries);
  // The same query (and key) TimeEntries reads, so the list below shares the cache.
  const q = useQuery({
    queryKey: fieldKeys.time(job.id),
    queryFn: () => listFn({ data: { id: job.id } }),
    enabled: !!session,
  });
  const rows = q.data ?? [];
  const hoursOf = (kind: string) =>
    rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.hours), 0);
  const summary = q.error ? (
    <span className="text-destructive">could not load</span>
  ) : q.isLoading ? null : rows.length === 0 ? (
    "no time yet"
  ) : (
    `Travel ${hoursText(hoursOf("travel"))} · Labor ${hoursText(hoursOf("labor"))}`
  );
  return (
    <Box
      title="Time"
      icon={Clock}
      collapsible
      defaultOpen={review}
      storageKey={review ? "time-review" : "time"}
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

/**
 * Owner, Oct 26: the office adds pictures to a ticket from its page, not only through the
 * technician's close-out. Each picked (or dropped) file is shrunk, uploaded under the ticket's
 * folder (field-utils uploadPlan) and recorded as an "other" photo — no repair, no checklist
 * item — one at a time with an "Uploading 2 of 5…" line; a file that fails is named in a toast
 * and the rest still go up. The photos list refreshes when the batch is done.
 */
function useOfficePictures(jobId: string) {
  const qc = useQueryClient();
  const registerFn = useServerFn(registerJobPhoto);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const batch = useMutation({
    mutationFn: async (picked: File[]) => {
      const files = imageFiles(picked);
      if (files.length === 0) {
        toast.error("Pick picture files (JPG, PNG, HEIC…)");
        return { landed: 0, total: 0 };
      }
      setProgress({ done: 0, total: files.length });
      let landed = 0;
      for (const [i, file] of files.entries()) {
        setProgress({ done: i, total: files.length });
        try {
          const shrunk = await shrinkPhoto(file);
          const [plan] = uploadPlan([shrunk], jobId);
          const path = plan!.path;
          await uploadToServiceBucket(path, shrunk.blob, shrunk.type);
          try {
            const row = await registerFn({
              data: {
                service_job_id: jobId,
                repair_id: null,
                item_key: null,
                role: "other",
                storage_path: path,
                file_name: shrunk.name || file.name || null,
                file_size: shrunk.blob.size,
                taken_at: new Date(file.lastModified || Date.now()).toISOString(),
              },
            });
            qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
              old ? [...old, row] : old,
            );
            landed += 1;
          } catch (e) {
            await removeFromServiceBucket(path);
            throw e;
          }
        } catch (e) {
          loudError(`${file.name || "A picture"} did not upload`, e);
        }
      }
      return { landed, total: files.length };
    },
    onSuccess: ({ landed, total }) => {
      if (total === 0) return;
      if (landed > 0) toast.success(landed === 1 ? "Picture added" : `${landed} pictures added`);
    },
    onSettled: () => {
      setProgress(null);
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(jobId) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
    },
  });
  return {
    add: (files: ArrayLike<File> | null | undefined) => {
      const list = Array.from(files ?? []);
      if (list.length > 0 && !batch.isPending) batch.mutate(list);
    },
    uploading: batch.isPending,
    progressText: progress ? uploadingLabel(progress.done, progress.total) : null,
  };
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
  const pictures = useOfficePictures(jobId);
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
        onChange={(e) => {
          pictures.add(e.target.files);
          e.target.value = "";
        }}
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
const FIELD_NOTE: Record<string, string> = {
  "left site": "Left the site",
  "stopped travelling": "Stopped travelling",
};
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
      // The clock's leaving rows (owner, Oct 15): "left site", "stopped travelling".
      if (e.note && !e.field_status) return { icon: Truck, text: FIELD_NOTE[e.note] ?? e.note };
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
  const add = useMutation({
    mutationFn: () => noteFn({ data: { id: jobId, note: note.trim() } }),
    onSuccess: (r) => {
      setNote("");
      toast.success(`Note added${toldSuffix(r.mentioned)}`);
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
    },
    onError: (e) => {
      // "Note added, but the mentions were not sent: …": the note is in, so it leaves the box.
      if (errText(e).startsWith("Note added")) {
        setNote("");
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
      title="Activity log"
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
        <MentionTextarea
          rows={2}
          placeholder={`Add a note to this ticket… ${MENTION_HINT}`}
          value={note}
          maxLength={5000}
          onValueChange={setNote}
        />
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
