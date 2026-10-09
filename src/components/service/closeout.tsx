/**
 * The technician's close-out on one scrolling screen (docs/service-module-design.md §5.3):
 * who is on the job (crew-box.tsx; owner, Sep 30: answered first — the rest opens after — and
 * editable later), repairs from the template chips with before / after photos (one line each,
 * one open at a time — owner, Oct 9), materials off the truck (one tap per piece, or any
 * material found by search, from the truck or the shop; materials-section.tsx), purchase orders for material bought for
 * the job (purchase-orders-section.tsx; no Approved toggle here), closing notes, time (typed to the
 * quarter hour), the customer's signature, then Complete.
 *
 * Everything saves as it is filled out (owner, Sep 30: no Save button): repairs, photos, time
 * and the signature as they are made, the text fields a moment after typing stops (a subtle
 * "Saved", a loud toast when it fails). The text is also kept in localStorage per ticket
 * (bid-o-matic:closeout:<id>) until the server has it, so a lost signal on the roof does not
 * lose typed notes. Photos are NOT queued offline: an upload without signal fails loudly, and
 * the file is kept on the repair for "Retry upload" (owner, Oct 9) until it lands or is discarded.
 *
 * Reached from My tickets' and the ticket page's Open ticket button (/service?id=<id>&closeout=1).
 * Owner, Oct 8: this IS the workflow — no En route / On site steps before it; a tech opens it,
 * takes the Before photos, leaves, comes back for the After photos and Complete. Time is typed
 * in the Time section (Complete points out a ticket with none).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ClipboardList,
  Loader2,
  Lock,
  MapPin,
  Minus,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { isOffice } from "@/lib/access";
import { closeoutDestination } from "@/lib/closeout-destination";
import {
  REPAIR_TAGS,
  readRepairTag,
  repairMatchesTag,
  writeRepairTag,
  type RepairTag,
} from "@/lib/repair-tags";
import {
  SERVICE_STAGES,
  STAGE_LABELS,
  TECH_STAGES,
  type ServiceJobRow,
  type ServiceJobWithTech,
  type ServiceStage,
} from "@/lib/service.functions";
import {
  deleteJobPhoto,
  deleteJobRepair,
  listJobPhotos,
  listJobRepairs,
  listRepairTemplates,
  photoObjectPath,
  recentRepairsForJob,
  registerJobPhoto,
  saveCloseout,
  saveJobRepair,
  setFieldStatus,
  type JobPhotoRow,
  type JobRepairRow,
  type RepairTemplateRow,
  type TimeEntryRow,
  listTimeEntries,
} from "@/lib/service-field.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/service/signature-pad";
import { PhotoThumb, SavedIndicator, TimeEntries } from "@/components/service/field-shared";
import { CrewBox } from "@/components/service/crew-box";
import { crewQuestionPending } from "@/lib/service-crew";
import { MaterialsSection } from "@/components/service/materials-section";
import { PurchaseOrdersSection } from "@/components/service/purchase-orders-section";
import { TicketExtras } from "@/components/service/ticket-extras";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { completeGaps, type CheckRead, type CompleteGaps } from "@/lib/closeout-check";
import { CLOSEOUT_TEXT_FIELDS, mergeSaved } from "@/lib/job-cache";
import { repairSummary } from "@/lib/closeout-repairs";
import { officeStageMessage } from "@/lib/office-stage-message";
import {
  clock,
  errText,
  fieldKeys,
  getPosition,
  localYmd,
  loudError,
  removeFromServiceBucket,
  uploadToServiceBucket,
  useAutosave,
  useSignedUrl,
  whenShort,
} from "@/components/service/field-utils";

// ---------------------------------------------------------------------------------------------
// The text fields and their local draft.

interface TextDraft {
  closing_notes: string;
  checked_in_with: string;
  checked_out_with: string;
  recommend_new_roof: boolean;
  signed_by: string;
}
const fromJob = (j: ServiceJobRow): TextDraft => ({
  closing_notes: j.closing_notes ?? "",
  checked_in_with: j.checked_in_with ?? "",
  checked_out_with: j.checked_out_with ?? "",
  recommend_new_roof: j.recommend_new_roof,
  signed_by: j.signed_by ?? "",
});
const sameDraft = (a: TextDraft, b: TextDraft) => JSON.stringify(a) === JSON.stringify(b);

const draftKey = (id: string) => `bid-o-matic:closeout:${id}`;
function readDraft(id: string): TextDraft | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<TextDraft>;
    if (typeof d !== "object" || d === null) return null;
    return {
      closing_notes: typeof d.closing_notes === "string" ? d.closing_notes : "",
      checked_in_with: typeof d.checked_in_with === "string" ? d.checked_in_with : "",
      checked_out_with: typeof d.checked_out_with === "string" ? d.checked_out_with : "",
      recommend_new_roof: d.recommend_new_roof === true,
      signed_by: typeof d.signed_by === "string" ? d.signed_by : "",
    };
  } catch {
    return null;
  }
}
function writeDraft(id: string, d: TextDraft) {
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(d));
  } catch {
    // Storage blocked (private mode): the draft lives only in this screen.
  }
}
function clearDraft(id: string) {
  try {
    window.localStorage.removeItem(draftKey(id));
  } catch {
    // Nothing to clear.
  }
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);
const FINISHED = ["done", "authorized", "invoiced", "closed"];
const asStage = (s: string): ServiceStage =>
  (SERVICE_STAGES as readonly string[]).includes(s) ? (s as ServiceStage) : "open";

/** Shrink a big camera photo (to 2048 px, JPEG) so it uploads on one bar of signal. */
async function shrinkPhoto(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  const keep = { blob: file as Blob, type: file.type || "image/jpeg", name: file.name };
  if (file.size < 1_500_000 || typeof createImageBitmap === "undefined") return keep;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return keep;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return keep;
    return { blob, type: "image/jpeg", name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {
    return keep; // A format the browser cannot decode (e.g. HEIC): upload it as taken.
  }
}

// ---------------------------------------------------------------------------------------------

export function CloseoutScreen({ job }: { job: ServiceJobWithTech }) {
  const { profile } = useAuth();
  const isTech = !isOffice(profile);
  const stage = job.stage as ServiceStage;
  const officeStage = isTech && !TECH_STAGES.includes(stage);
  const canEdit = (!isTech || job.technician_id === profile?.id) && !officeStage;

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-10">
            <Link to="/service/today">
              <ArrowLeft className="mr-1 h-4 w-4" /> My tickets
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-10">
            <Link to="/service" search={{ id: job.id }}>
              Ticket details
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          Close out #{job.number} · {job.customer_name}
        </h1>
        {(job.site_name || job.site_address) && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            {[job.site_name, job.site_address].filter(Boolean).join(", ")}
          </p>
        )}
        {job.description && <p className="text-sm">{job.description}</p>}
        {FINISHED.includes(job.stage) && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {job.completed_at ? `Done ${whenShort(job.completed_at)}` : "Done"}
          </p>
        )}
      </div>
      {canEdit ? (
        <CloseoutForm key={job.id} job={job} />
      ) : (
        <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <Lock className="h-4 w-4 shrink-0" />
          {officeStage
            ? `${officeStageMessage(job.stage)}; ask the office if something needs changing.`
            : `This ticket is assigned to ${job.technician_name ?? "someone else"}; only they or the office can close it out.`}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  aside,
}: {
  title: string;
  icon: typeof Wrench;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Icon className="h-5 w-5 text-muted-foreground" /> {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function CloseoutForm({ job }: { job: ServiceJobWithTech }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { profile, session } = useAuth();
  const saveFn = useServerFn(saveCloseout);
  const statusFn = useServerFn(setFieldStatus);
  const timeFn = useServerFn(listTimeEntries);

  const [stored] = useState<TextDraft | null>(() => readDraft(job.id));
  const [draft, setDraft] = useState<TextDraft>(() => stored ?? fromJob(job));
  const latest = useRef(draft);

  const input = (d: TextDraft) => ({
    id: job.id,
    closing_notes: orNull(d.closing_notes),
    checked_in_with: orNull(d.checked_in_with),
    checked_out_with: orNull(d.checked_out_with),
    recommend_new_roof: d.recommend_new_roof,
    signed_by: orNull(d.signed_by),
  });
  // Owner, Oct 9: only the fields this save sent go into the cache (job-cache.ts) — the whole
  // row landing after a signature save used to blank the signature.
  const keepRow = (row: ServiceJobRow) =>
    qc.setQueryData<ServiceJobWithTech>(fieldKeys.job(job.id), (old) =>
      mergeSaved(old, row, CLOSEOUT_TEXT_FIELDS),
    );

  // The text saves itself a moment after typing stops; the phone's copy goes once the server
  // has the latest.
  const autosave = useAutosave<TextDraft>(
    async (d) => {
      const row = await saveFn({ data: input(d) });
      keepRow(row);
      if (sameDraft(d, latest.current)) clearDraft(job.id);
    },
    { what: "Your notes" },
  );
  const update = (patch: Partial<TextDraft>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    writeDraft(job.id, next);
    autosave.push(next);
  };
  const told = useRef(false);
  useEffect(() => {
    if (told.current || !stored) return;
    told.current = true;
    if (!sameDraft(stored, fromJob(job))) {
      toast.info("Restored the notes you typed here before; saving them now.");
      autosave.push(stored);
    }
  }, [stored, job, autosave]);

  const complete = useMutation({
    mutationFn: async () => {
      autosave.cancel();
      const row = await saveFn({ data: input(latest.current) });
      // Already finished and stamped: nothing more to record. A ticket the office set Done /
      // Invoiced / Closed from the stage picker is still stamped here (owner, Oct 5: #6004).
      if (FINISHED.includes(row.stage) && row.completed_at) return row;
      // The phone's own calendar day: the labor entry's date (not UTC's day).
      return statusFn({ data: { id: job.id, to: "done", day: localYmd() } });
    },
    onSuccess: (row) => {
      // The stage and the stamps changed too: the whole row, then a re-read (invalidated below).
      qc.setQueryData<ServiceJobWithTech>(fieldKeys.job(job.id), (old) =>
        old ? { ...old, ...row } : old,
      );
      clearDraft(job.id);
      for (const k of [
        fieldKeys.today,
        fieldKeys.job(job.id),
        fieldKeys.events(job.id),
        fieldKeys.time(job.id),
        ["service-jobs"],
      ])
        void qc.invalidateQueries({ queryKey: k });
      // Say what is true: the office's stage stays; "the office invoices and closes it" only
      // when the ticket is now Done and waiting on them.
      toast.success(
        row.stage === "done"
          ? "Done — the office invoices and closes it"
          : `Close-out saved — the ticket stays ${STAGE_LABELS[asStage(row.stage)]}`,
      );
      // A technician goes back to their day; the office (owner, Oct 5: a manager closing out
      // from the ticket) back to the ticket, where the stage and the Close-out fold now agree.
      // The office is isOffice, not "no Technician tick" (owner, Oct 6: an admin ticked
      // Technician landed on Today) — closeout-destination.ts.
      void navigate(closeoutDestination(profile, job.id));
    },
    onError: (e) =>
      loudError("Could not complete the ticket (your typing is kept on this phone)", e),
  });

  const busy = complete.isPending;
  const finished = FINISHED.includes(job.stage);

  // M2 (owner, Oct 5): Complete first lists what is missing — a repair without its Before /
  // After photo, no closing notes, no signature — with "Go back" and "Complete anyway". The
  // same queries (and cache) the Repairs section reads.
  const repairsFn = useServerFn(listJobRepairs);
  const photosFn = useServerFn(listJobPhotos);
  // Owner, Oct 9 (S13): fresh for 30 s, so coming back from the camera does not re-read
  // everything; a save still invalidates what it changed.
  const repairsQ = useQuery({
    queryKey: fieldKeys.repairs(job.id),
    queryFn: () => repairsFn({ data: { id: job.id } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const photosQ = useQuery({
    queryKey: fieldKeys.photos(job.id),
    queryFn: () => photosFn({ data: { id: job.id } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const timeQ = useQuery({
    queryKey: fieldKeys.time(job.id),
    queryFn: () => timeFn({ data: { id: job.id } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const [missing, setMissing] = useState<string[]>([]);
  const [unread, setUnread] = useState(false);
  // Owner, Oct 9: a read that failed or is still loading is a line of its own (closeout-check.ts
  // completeGaps) — Complete used to pass silently with no checks when one had no rows yet.
  const gapsOf = (reads: {
    repairs: CheckRead<JobRepairRow[]>;
    photos: CheckRead<JobPhotoRow[]>;
    time: CheckRead<TimeEntryRow[]>;
  }) =>
    completeGaps({
      finished,
      service_type: job.service_type,
      signature_path: job.signature_path,
      closing_notes: latest.current.closing_notes,
      // Labor from an On site stamp (older tickets) is added by Complete itself.
      on_site_at: job.on_site_at,
      ...reads,
    });
  const judge = (g: CompleteGaps) => {
    if (g.gaps.length > 0) {
      setMissing(g.gaps);
      setUnread(g.unread);
    } else {
      setMissing([]); // Retry found nothing missing: the dialog closes and Complete runs.
      complete.mutate();
    }
  };
  const pressComplete = () => judge(gapsOf({ repairs: repairsQ, photos: photosQ, time: timeQ }));
  // Retry re-reads the three and judges their answers (not the closure's, which may be stale).
  const retry = useMutation({
    mutationFn: async () => {
      const [repairs, photos, time] = await Promise.all([
        repairsQ.refetch(),
        photosQ.refetch(),
        timeQ.refetch(),
      ]);
      return gapsOf({ repairs, photos, time });
    },
    onSuccess: judge,
    onError: (e) => loudError("Could not re-check the ticket", e),
  });
  // Owner, Sep 30: "Who is on this job with you?" comes first; the rest opens once answered.
  const waiting = crewQuestionPending(job);

  return (
    <div className="space-y-5">
      {/* (a) Who is on the job */}
      <CrewBox job={job} />

      {waiting ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          Check-in details, photos, repairs and the rest open once you have answered who is on the
          job.
        </p>
      ) : (
        <>
          {/* Inspection checklist (Inspection tickets) and the Aerial markup */}
          <TicketExtras job={job} canEdit />

          {/* (b) Repairs */}
          <RepairsSection jobId={job.id} ticketNumber={job.number} />

          {/* (c) Materials */}
          <MaterialsSection jobId={job.id} />

          {/* (c2) Purchase orders: material bought for the job (never the Approved toggle here) */}
          <PurchaseOrdersSection jobId={job.id} field />

          {/* (d) Notes */}
          <Section title="Notes" icon={ClipboardList}>
            <div className="space-y-1">
              <Label htmlFor="co-notes">Closing notes</Label>
              <Textarea
                id="co-notes"
                rows={5}
                className="text-base"
                placeholder="What you found and did (the keyboard's microphone works here)"
                value={draft.closing_notes}
                onChange={(e) => update({ closing_notes: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="co-in">Checked in with</Label>
                <Input
                  id="co-in"
                  className="h-11 text-base"
                  maxLength={200}
                  value={draft.checked_in_with}
                  onChange={(e) => update({ checked_in_with: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="co-out">Checked out with</Label>
                <Input
                  id="co-out"
                  className="h-11 text-base"
                  maxLength={200}
                  value={draft.checked_out_with}
                  onChange={(e) => update({ checked_out_with: e.target.value })}
                />
              </div>
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className="font-medium">Recommend a new roof</span>
              <Switch
                checked={draft.recommend_new_roof}
                onCheckedChange={(v) => update({ recommend_new_roof: v })}
              />
            </label>
          </Section>

          {/* (e) Time */}
          <Section title="Time" icon={Clock}>
            {job.on_site_at && !finished && (
              <p className="text-sm text-muted-foreground">
                Labor from On site ({clock(job.on_site_at)}) until now is added when you press
                Complete.
              </p>
            )}
            <TimeEntries jobId={job.id} editable defaultHelpers={job.helper_count} />
          </Section>

          {/* (f) Signature */}
          <Section title="Signature" icon={PenLine}>
            <div className="space-y-1">
              <Label htmlFor="co-signed-by">Signed by</Label>
              <Input
                id="co-signed-by"
                className="h-11 text-base"
                maxLength={200}
                placeholder="Customer's name"
                value={draft.signed_by}
                onChange={(e) => update({ signed_by: e.target.value })}
              />
            </div>
            <SignatureSection job={job} />
          </Section>

          {/* (g) Complete (the rest saves itself) */}
          <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="mb-2 flex min-h-4 items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Everything saves as you go.</span>
              <SavedIndicator state={autosave.state} />
            </div>
            <Button
              type="button"
              className="h-14 w-full text-lg font-semibold"
              disabled={busy}
              onClick={pressComplete}
            >
              {complete.isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-5 w-5" />
              )}
              {finished ? "Finish" : "Complete"}
            </Button>
          </div>
          <AlertDialog open={missing.length > 0} onOpenChange={(o) => !o && setMissing([])}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Before you finish</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <ul className="list-disc space-y-1 pl-5 text-left text-base">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-12">Go back</AlertDialogCancel>
                {unread && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    {retry.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Retry
                  </Button>
                )}
                <AlertDialogAction
                  className="h-12"
                  onClick={() => {
                    setMissing([]);
                    complete.mutate();
                  }}
                >
                  Complete anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (b) Repairs

function Chip({
  children,
  onClick,
  disabled,
  tone = "outline",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean | undefined;
  tone?: "outline" | "secondary" | undefined;
}) {
  return (
    <Button
      type="button"
      variant={tone}
      className="h-10 max-w-full justify-start rounded-full px-4 text-sm"
      disabled={disabled}
      onClick={onClick}
    >
      <Plus className="mr-1 h-4 w-4 shrink-0" />
      <span className="truncate">{children}</span>
    </Button>
  );
}

/** A roof-type chip above the repair picker (owner, Oct 6): the pressed one filters the list. */
function TagChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      className="h-10 rounded-full px-3 text-sm"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** A before or after photo (the camera buttons; the signature is registered elsewhere). */
type PhotoRole = "before" | "after";
/** A photo that did not upload, kept on its repair for Retry upload (owner, Oct 9). */
interface Shot {
  file: File;
  role: PhotoRole;
}

function RepairsSection({ jobId, ticketNumber }: { jobId: string; ticketNumber: number }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const repairsFn = useServerFn(listJobRepairs);
  const photosFn = useServerFn(listJobPhotos);
  const recentFn = useServerFn(recentRepairsForJob);
  const templatesFn = useServerFn(listRepairTemplates);
  const saveFn = useServerFn(saveJobRepair);
  const registerFn = useServerFn(registerJobPhoto);

  // Owner, Oct 9 (S13): fresh for 30 s — a return from the camera is not a re-read of all.
  const repairs = useQuery({
    queryKey: fieldKeys.repairs(jobId),
    queryFn: () => repairsFn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const photos = useQuery({
    queryKey: fieldKeys.photos(jobId),
    queryFn: () => photosFn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const recent = useQuery({
    queryKey: ["repair-templates-recent", jobId],
    queryFn: () => recentFn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  // Roof-type chips (owner, Oct 6: "the repair tags … please fix"): the chosen chip filters
  // the top list and the search on the server (listRepairTemplates' tag) and is remembered on
  // this phone (repair-tags.ts). All until the stored chip is read, after mount (no storage on
  // the server render).
  const [tag, setTag] = useState<RepairTag | null>(null);
  useEffect(() => setTag(readRepairTag()), []);
  const pickTag = (t: RepairTag | null) => {
    setTag(t);
    writeRepairTag(t);
  };
  const favs = useQuery({
    queryKey: ["repair-templates", "top", tag],
    queryFn: () => templatesFn({ data: { limit: 24, tag: tag ?? undefined } }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const found = useQuery({
    queryKey: ["repair-templates", "q", q, tag],
    queryFn: () => templatesFn({ data: { q, limit: 30, tag: tag ?? undefined } }),
    enabled: !!session && q.length >= 2,
    staleTime: 60_000,
  });
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherName, setOtherName] = useState("");
  // Owner, Oct 9 ("the repairs look the same?"): the picker — roof-type chips and thirty
  // tap-to-add chips — took most of the screen. It folds behind "Add another repair" once a
  // repair is on the ticket, the search sits first, and the chips show eight until "Show all".
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allChips, setAllChips] = useState(false);
  // Owner, Oct 9: with several repairs the full cards made a very long page. Each repair is one
  // folded row (RepairRow); one is open at a time — the one just added, or the only one — and
  // nothing is remembered across reloads.
  const [expanded, setExpanded] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (t: RepairTemplateRow | { name: string }) =>
      saveFn({
        data:
          "id" in t
            ? {
                service_job_id: jobId,
                repair_template_id: t.id,
                name: t.name,
                unit: t.unit || "EA",
                quantity: 1,
                problem_text: t.description,
                resolution_text: t.work_completed,
                // Completed today on the phone's calendar (not UTC's day).
                day: localYmd(),
              }
            : { service_job_id: jobId, name: t.name, unit: "EA", quantity: 1, day: localYmd() },
      }),
    onSuccess: (row) => {
      qc.setQueryData<JobRepairRow[]>(fieldKeys.repairs(jobId), (old) => [...(old ?? []), row]);
      toast.success(`Added ${row.name}`);
      setOtherName("");
      setOtherOpen(false);
      setExpanded(row.id);
      setPickerOpen(false);
      setAllChips(false);
    },
    onError: (e) => loudError("Could not add the repair", e),
  });

  // Owner, Oct 9: the camera is ONE mutation for the section, with two hidden file inputs, so
  // a folded row's Before / After buttons (RepairRow) and the open card share it — a tech taps
  // a row's camera without opening the card. `aim` is the repair the next picked file goes to.
  // A failed upload keeps its file here (`failed`, one per repair) for "Retry upload": the file
  // used to be thrown away with the error. A success or Discard lets it go.
  const beforeRef = useRef<HTMLInputElement | null>(null);
  const afterRef = useRef<HTMLInputElement | null>(null);
  const aim = useRef<string | null>(null);
  const [failed, setFailed] = useState<Record<string, Shot>>({});
  const upload = useMutation({
    mutationFn: async ({ file, role, repairId }: Shot & { repairId: string }) => {
      // GPS runs beside the upload and gives up after 3 s; a photo never waits on it.
      const where = getPosition(3000);
      const shrunk = await shrinkPhoto(file);
      const path = photoObjectPath(jobId, shrunk.name || "photo.jpg");
      await uploadToServiceBucket(path, shrunk.blob, shrunk.type);
      const pos = await where;
      try {
        return await registerFn({
          data: {
            service_job_id: jobId,
            repair_id: repairId,
            role,
            storage_path: path,
            file_name: shrunk.name || null,
            file_size: shrunk.blob.size,
            taken_at: new Date(file.lastModified || Date.now()).toISOString(),
            lat: pos?.lat ?? null,
            lng: pos?.lng ?? null,
          },
        });
      } catch (e) {
        await removeFromServiceBucket(path);
        throw e;
      }
    },
    onSuccess: (row, v) => {
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) => [...(old ?? []), row]);
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
      setFailed((f) => {
        if (!(v.repairId in f)) return f;
        const { [v.repairId]: _landed, ...rest } = f;
        return rest;
      });
      toast.success(`${row.role === "before" ? "Before" : "After"} photo saved`);
    },
    onError: (e, v) => {
      setFailed((f) => ({ ...f, [v.repairId]: { file: v.file, role: v.role } }));
      loudError(
        `The ${v.role} photo did not upload (it is kept on the repair — Retry upload with signal)`,
        e,
      );
    },
  });
  const takePhoto = (repairId: string, role: PhotoRole) => {
    aim.current = repairId;
    (role === "before" ? beforeRef : afterRef).current?.click();
  };
  const pick = (role: PhotoRole) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const repairId = aim.current;
    if (!repairId) return;
    for (const file of files) upload.mutate({ file, role, repairId });
  };
  const photoControls = (r: JobRepairRow): PhotoControls => ({
    uploading:
      upload.isPending && upload.variables?.repairId === r.id ? upload.variables.role : null,
    failed: failed[r.id],
    onPhoto: (role) => takePhoto(r.id, role),
    onRetry: () => {
      const shot = failed[r.id];
      if (shot) upload.mutate({ ...shot, repairId: r.id });
    },
    onDiscard: () =>
      setFailed((f) => {
        const { [r.id]: _dropped, ...rest } = f;
        return rest;
      }),
  });

  // The ticket's usual repairs are not re-fetched per chip: hide the ones outside it here.
  const recentRows = (recent.data ?? []).filter((t) => repairMatchesTag(t.tags, tag));
  const recentIds = new Set(recentRows.map((t) => t.id));
  const favRows = (favs.data ?? []).filter((t) => !recentIds.has(t.id));
  const rows = repairs.data ?? [];
  const allPhotos = photos.data ?? [];
  const openId = rows.length === 1 ? (rows[0]?.id ?? null) : expanded;
  const showPicker = rows.length === 0 || pickerOpen;
  // Owner, Oct 9 (S5): two characters typed → the matches sit right under the box and the
  // chips are out of the way (they used to grow to the full list while typing).
  const searching = q.length >= 2;
  const chipRows = allChips ? favRows : favRows.slice(0, PICKER_CHIPS);

  return (
    <Section
      title="Repairs"
      icon={Wrench}
      aside={
        rows.length > 0 ? (
          <span className="text-sm text-muted-foreground">{rows.length} added</span>
        ) : undefined
      }
    >
      {/* Owner, Oct 9 (B2): a failed background re-read keeps the cached rows on screen. */}
      {repairs.error && (
        <p className="text-sm text-destructive">
          {repairs.data ? "Could not refresh the repairs" : "Could not load the repairs"}:{" "}
          {errText(repairs.error)}
        </p>
      )}
      {photos.error && (
        <p className="text-sm text-destructive">
          {photos.data ? "Could not refresh the photos" : "Could not load the photos"}:{" "}
          {errText(photos.error)}
        </p>
      )}
      <input
        ref={beforeRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={pick("before")}
      />
      <input
        ref={afterRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={pick("after")}
      />
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) =>
            openId === r.id ? (
              <RepairCard
                key={r.id}
                jobId={jobId}
                ticketNumber={ticketNumber}
                repair={r}
                photos={allPhotos.filter((p) => p.repair_id === r.id)}
                onCollapse={rows.length > 1 ? () => setExpanded(null) : null}
                camera={photoControls(r)}
              />
            ) : (
              <RepairRow
                key={r.id}
                repair={r}
                photos={allPhotos.filter((p) => p.repair_id === r.id)}
                onOpen={() => setExpanded(r.id)}
                camera={photoControls(r)}
              />
            ),
          )}
        </div>
      )}

      {!showPicker && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full text-base"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="mr-2 h-5 w-5" /> Add another repair
        </Button>
      )}
      {showPicker && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              className="h-11 pl-9 text-base"
              placeholder="Search all repairs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {searching && (
            <div className="flex flex-wrap gap-2">
              {found.isLoading ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </span>
              ) : found.error ? (
                <p className="text-sm text-destructive">Search failed: {errText(found.error)}</p>
              ) : (found.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No repair named like “{q}”. Use Other to type it.
                </p>
              ) : (
                (found.data ?? []).map((t) => (
                  <Chip key={t.id} disabled={add.isPending} onClick={() => add.mutate(t)}>
                    {t.name}
                  </Chip>
                ))
              )}
              <Chip tone="secondary" onClick={() => setOtherOpen((v) => !v)}>
                Other
              </Chip>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Roof type">
            <TagChip active={tag === null} onClick={() => pickTag(null)}>
              All
            </TagChip>
            {REPAIR_TAGS.map((t) => (
              <TagChip key={t.value} active={tag === t.value} onClick={() => pickTag(t.value)}>
                {t.label}
              </TagChip>
            ))}
          </div>
          {!searching && recentRows.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Usual here
              </p>
              <div className="flex flex-wrap gap-2">
                {recentRows.map((t) => (
                  <Chip
                    key={t.id}
                    tone="secondary"
                    disabled={add.isPending}
                    onClick={() => add.mutate(t)}
                  >
                    {t.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {!searching && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {rows.length ? "Add another" : "Tap a repair to add it"}
              </p>
              {favs.error && (
                <p className="text-sm text-destructive">
                  Could not load the repair list: {errText(favs.error)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {chipRows.map((t) => (
                  <Chip key={t.id} disabled={add.isPending} onClick={() => add.mutate(t)}>
                    {t.name}
                  </Chip>
                ))}
                {favRows.length > PICKER_CHIPS && (
                  <Chip tone="secondary" onClick={() => setAllChips((v) => !v)}>
                    {allChips ? "Show fewer" : `Show all ${favRows.length}`}
                  </Chip>
                )}
                <Chip tone="secondary" onClick={() => setOtherOpen((v) => !v)}>
                  Other
                </Chip>
              </div>
            </div>
          )}
          {otherOpen && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = otherName.trim();
                if (!name) {
                  loudError("Name the repair", new Error("type what you did, e.g. Patched seam"));
                  return;
                }
                add.mutate({ name });
              }}
            >
              <Input
                autoFocus
                className="h-11 text-base"
                maxLength={200}
                placeholder="What repair? e.g. Patched seam"
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
              />
              <Button type="submit" className="h-11" disabled={add.isPending}>
                Add
              </Button>
            </form>
          )}
          {rows.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full"
              onClick={() => setPickerOpen(false)}
            >
              Done adding
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

/** Tap-to-add chips shown before "Show all" (owner, Oct 9: the picker took the screen). */
const PICKER_CHIPS = 8;

interface RepairVals {
  name: string;
  quantity: number;
  problem_text: string;
  resolution_text: string;
}
const repairVals = (r: JobRepairRow): RepairVals => ({
  name: r.name,
  quantity: Number(r.quantity),
  problem_text: r.problem_text ?? "",
  resolution_text: r.resolution_text ?? "",
});

/** The section's camera, handed to a repair's row and card (see RepairsSection). */
interface PhotoControls {
  /** The role uploading for this repair now, else null. */
  uploading: PhotoRole | null;
  /** The last photo of this repair that did not upload, until it lands or is discarded. */
  failed: Shot | undefined;
  onPhoto: (role: PhotoRole) => void;
  onRetry: () => void;
  onDiscard: () => void;
}

/**
 * The Before (n) / After (n) camera buttons and, under them, the failed photo's "Retry upload"
 * / "Discard" line. `compact`: the folded row's size; else the card's two wide buttons.
 */
function PhotoButtons({
  photos,
  camera,
  compact,
}: {
  photos: JobPhotoRow[];
  camera: PhotoControls;
  compact?: boolean | undefined;
}) {
  const { uploading, failed, onPhoto, onRetry, onDiscard } = camera;
  const count = (role: PhotoRole) => photos.filter((p) => p.role === role).length;
  return (
    <>
      <div className={compact ? "flex gap-2" : "grid grid-cols-2 gap-2"}>
        {(["before", "after"] as const).map((role) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            className={compact ? "h-10 px-3 text-sm" : "h-11 text-base"}
            disabled={uploading === role}
            onClick={() => onPhoto(role)}
          >
            {uploading === role ? (
              <Loader2
                className={compact ? "mr-1 h-4 w-4 animate-spin" : "mr-2 h-5 w-5 animate-spin"}
              />
            ) : (
              <Camera className={compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} />
            )}
            {role === "before" ? "Before" : "After"}
            {count(role) ? ` (${count(role)})` : ""}
          </Button>
        ))}
      </div>
      {failed && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-destructive">
            The {failed.role === "before" ? "Before" : "After"} photo did not upload
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={uploading !== null}
            onClick={onRetry}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Retry upload
          </Button>
          <Button type="button" variant="ghost" className="h-10" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * A repair folded to one line (owner, Oct 9): name, "× qty unit" and a chevron open the card;
 * under them its own Before (n) / After (n) camera buttons (so a photo never needs the card
 * open) beside, in amber, what it still needs (closeout-repairs.ts).
 */
function RepairRow({
  repair,
  photos,
  onOpen,
  camera,
}: {
  repair: JobRepairRow;
  photos: JobPhotoRow[];
  onOpen: () => void;
  camera: PhotoControls;
}) {
  const s = repairSummary(repair, photos);
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 px-3 py-2">
      <button
        type="button"
        aria-expanded={false}
        aria-label={`Open ${repair.name || "repair"}`}
        className="flex min-h-11 w-full items-center gap-3 rounded-md text-left hover:bg-muted/40"
        onClick={onOpen}
      >
        <p className="min-w-0 flex-1 truncate font-semibold leading-snug">
          {repair.name || "Repair"}{" "}
          <span className="font-normal text-muted-foreground">{s.qtyText}</span>
        </p>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PhotoButtons photos={photos} camera={camera} compact />
        {s.needs.length > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            needs: {s.needs.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

function RepairCard({
  jobId,
  ticketNumber,
  repair,
  photos,
  onCollapse,
  camera,
}: {
  jobId: string;
  ticketNumber: number;
  repair: JobRepairRow;
  photos: JobPhotoRow[];
  /** Fold the card back to its row; null when it is the only repair (always open). */
  onCollapse: (() => void) | null;
  camera: PhotoControls;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveJobRepair);
  const deleteFn = useServerFn(deleteJobRepair);
  const deletePhotoFn = useServerFn(deleteJobPhoto);
  const [vals, setVals] = useState<RepairVals>(() => repairVals(repair));
  const [confirmRemove, setConfirmRemove] = useState(false);

  const save = useMutation({
    mutationFn: (v: RepairVals) =>
      saveFn({
        data: {
          id: repair.id,
          service_job_id: jobId,
          repair_template_id: repair.repair_template_id,
          name: v.name.trim() || repair.name,
          quantity: v.quantity,
          unit: repair.unit || "EA",
          problem_text: orNull(v.problem_text),
          resolution_text: orNull(v.resolution_text),
          completed_on: repair.completed_on,
          print_on_invoice: repair.print_on_invoice,
        },
      }),
    onSuccess: (row) =>
      qc.setQueryData<JobRepairRow[]>(fieldKeys.repairs(jobId), (old) =>
        old?.map((r) => (r.id === row.id ? row : r)),
      ),
    onError: (e) => loudError(`Could not save ${repair.name}`, e),
  });
  const commit = (next?: Partial<RepairVals>) => {
    const v = { ...vals, ...next };
    if (JSON.stringify(v) === JSON.stringify(repairVals(repair))) return;
    save.mutate(v);
  };

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: repair.id, service_job_id: jobId } }),
    onSuccess: () => {
      qc.setQueryData<JobRepairRow[]>(fieldKeys.repairs(jobId), (old) =>
        old?.filter((r) => r.id !== repair.id),
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(jobId) });
      toast.success(`Removed ${repair.name}`);
    },
    onError: (e) => loudError("Could not remove the repair", e),
  });

  const delPhoto = useMutation({
    mutationFn: (id: string) => deletePhotoFn({ data: { id, service_job_id: jobId } }),
    onSuccess: (_r, id) =>
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
        old?.filter((p) => p.id !== id),
      ),
    onError: (e) => loudError("Could not delete the photo", e),
  });

  const free = !repair.repair_template_id;

  return (
    <article className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {free ? (
            <Input
              aria-label="Repair name"
              className="h-11 text-base font-semibold"
              maxLength={200}
              value={vals.name}
              onChange={(e) => setVals((v) => ({ ...v, name: e.target.value }))}
              onBlur={() => commit()}
            />
          ) : (
            <h3 className="pt-2 font-semibold leading-snug">{repair.name}</h3>
          )}
        </div>
        {save.isPending && <Loader2 className="mt-3 h-4 w-4 animate-spin text-muted-foreground" />}
        {/* Owner, Oct 9: Remove sits in the header (a small ghost button), not on a row of its own. */}
        {!confirmRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 px-2 text-xs text-destructive hover:text-destructive"
            aria-label={`Remove ${repair.name || "repair"}`}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Remove
          </Button>
        )}
        {onCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            aria-label={`Fold ${repair.name || "repair"}`}
            aria-expanded
            onClick={onCollapse}
          >
            <ChevronUp className="h-5 w-5" />
          </Button>
        )}
      </div>
      {confirmRemove && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm">Remove this repair and its photos?</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-10"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Remove
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={() => setConfirmRemove(false)}
          >
            Keep
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">Quantity</Label>
        <div className="w-24">
          <NumberField
            value={vals.quantity}
            step="any"
            inputMode="decimal"
            className="h-11 text-center text-base"
            onChange={(n) => setVals((v) => ({ ...v, quantity: n }))}
            onBlur={() => commit()}
          />
        </div>
        <span className="text-sm text-muted-foreground">{repair.unit}</span>
      </div>

      <div className="space-y-1">
        <Label className="text-sm">Problem</Label>
        <Textarea
          rows={2}
          className="text-base"
          value={vals.problem_text}
          onChange={(e) => setVals((v) => ({ ...v, problem_text: e.target.value }))}
          onBlur={() => commit()}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-sm">Work completed</Label>
        <Textarea
          rows={2}
          className="text-base"
          value={vals.resolution_text}
          onChange={(e) => setVals((v) => ({ ...v, resolution_text: e.target.value }))}
          onBlur={() => commit()}
        />
      </div>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <PhotoThumb
              key={p.id}
              photo={p}
              deleting={delPhoto.isPending && delPhoto.variables === p.id}
              onDelete={() => delPhoto.mutate(p.id)}
              // Tap a photo to circle the problem, add an arrow or words (owner, Oct 1).
              canAnnotate
              ticketNumber={ticketNumber}
            />
          ))}
        </div>
      )}

      <PhotoButtons photos={photos} camera={camera} />
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// (f) Signature

function SignatureSection({ job }: { job: ServiceJobWithTech }) {
  const qc = useQueryClient();
  const registerFn = useServerFn(registerJobPhoto);
  const url = useSignedUrl(job.signature_path);
  const [signAgain, setSignAgain] = useState(false);
  const saveSig = useMutation({
    mutationFn: async (png: Blob) => {
      const path = `${job.id}/signature-${Date.now()}.png`;
      await uploadToServiceBucket(path, png, "image/png");
      try {
        return await registerFn({
          data: {
            service_job_id: job.id,
            role: "signature",
            storage_path: path,
            file_name: "signature.png",
            file_size: png.size,
            taken_at: new Date().toISOString(),
          },
        });
      } catch (e) {
        await removeFromServiceBucket(path);
        throw e;
      }
    },
    onSuccess: (row) => {
      qc.setQueryData<ServiceJobWithTech>(fieldKeys.job(job.id), (old) =>
        old ? { ...old, signature_path: row.storage_path, signed_at: row.created_at } : old,
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(job.id) });
      setSignAgain(false);
      toast.success("Signature saved");
    },
    onError: (e) => loudError("The signature did not save; check your signal and save again", e),
  });

  if (job.signature_path && !signAgain)
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-md border bg-white">
          {url.data ? (
            <img src={url.data} alt="Customer's signature" className="mx-auto max-h-44" />
          ) : url.error ? (
            <p className="p-3 text-sm text-destructive">
              Could not show the signature: {errText(url.error)}
            </p>
          ) : (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the signature…
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{job.signed_at ? `Signed ${whenShort(job.signed_at)}` : "Signed"}</span>
          <Button type="button" variant="ghost" className="h-10" onClick={() => setSignAgain(true)}>
            Sign again
          </Button>
        </div>
      </div>
    );
  return (
    <div className="space-y-1">
      <SignaturePad saving={saveSig.isPending} onSave={(png) => saveSig.mutate(png)} />
      {signAgain && (
        <Button type="button" variant="ghost" className="h-10" onClick={() => setSignAgain(false)}>
          Keep the saved signature
        </Button>
      )}
    </div>
  );
}
