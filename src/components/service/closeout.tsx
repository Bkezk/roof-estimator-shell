/**
 * The technician's close-out on one scrolling screen (docs/service-module-design.md §5.3), as
 * seven steps that unlock in order (closeout-steps.ts; owner, Oct 9: "questions have to be
 * answered to proceed … unlocking each step after the last is complete"): 1 who is on the job
 * (crew-box.tsx; owner, Sep 30: answered first — the rest opens after — and editable later),
 * 2 the repairs from the template chips with their Before photos (one line each, one open at a
 * time — owner, Oct 9; the Inspection checklist and Aerial markup sit here), 3 the work — what
 * was done and the After photos, 4 materials off the truck (one tap per piece, or any material
 * found by search, from the truck or the shop; materials-section.tsx) and purchase orders for
 * material bought for the job (purchase-orders-section.tsx; no Approved toggle here), 5 time
 * (typed to the quarter hour), 6 closing notes, 7 the customer's signature, then Complete. Each
 * step is one card (StepCard; owner, Oct 9: "a box in a box … awkward and cramped"): a done step
 * that is not the current one folds to its header and a one-line summary with Edit; a locked
 * one is a single muted line; the strip above is one line of numbered dots.
 *
 * Everything saves as it is filled out (owner, Sep 30: no Save button): repairs, photos, time
 * and the signature as they are made, the text fields a moment after typing stops (a subtle
 * "Saved", a loud toast when it fails). The text is also kept in localStorage per ticket
 * (bid-o-matic:closeout:<id>) until the server has it, so a lost signal on the roof does not
 * lose typed notes. Photos are NOT queued offline: an upload without signal fails loudly, and
 * the file is kept on the repair for "Retry upload" (owner, Oct 9) until it lands or is discarded.
 *
 * Reached from My tickets' and the ticket page's Open ticket button (/service?id=<id>&closeout=1).
 * This IS the workflow (owner, Oct 8): a tech opens it, takes the Before photos, leaves, comes
 * back for the After photos and Complete. The clock (owner, Oct 15, CenterPoint-style; the Oct 8
 * "no En route / On site buttons" is superseded — the buttons are back as the clock on My
 * tickets, tech-clock.ts): while the technician's clock runs on this ticket a line near the top
 * says so ("On site at #6014 Bell County · 1 h 20 m") with Leave site, and Complete clocks them
 * out (the server writes the labor entry from the clock, setFieldStatus "done"). Time not on the
 * clock is typed in the Time section (Complete points out a ticket with none); with no Travel
 * line yet the section opens prefilled with the office → site estimate (field-shared.tsx
 * TimeEntries, suggestTravel; owner, Oct 9). Step 6 can be skipped ("Skip — nothing to add", a
 * phone mark like "Nothing used"; owner, Oct 9: the notes are "kind of redundant") and is not a
 * Complete gap.
 *
 * Owner, Oct 9 (from the phone): "ill have everything i need in there and it wont go to the next
 * step … instead of auto swapping to the next step it should have a go to next step button at
 * the bottom." A step never advances on its own: the form keeps the step the tech is ON
 * (`onStep`, set once the reads settle, never remembered) and the current card ends in a
 * "Next step: <title>" button — enabled once the step's rule holds, until then disabled over one
 * line saying what is still needed (closeout-steps.ts stepMissing). Pressing it moves `onStep`
 * on and scrolls the next card into view; the step left folds to its summary. "Nothing used" and
 * "Skip — nothing to add" only mark their step done; Next is the one way forward. The sticky
 * bar's "Finish step N" names the REAL first open step and takes the tech there the same way.
 *
 * Owner, Oct 12: an INSPECTION ticket (service_type "inspection") closes out through its own six
 * steps (closeout-steps.ts closeoutSteps; the cards are inspection-closeout.tsx): 1 Who is here,
 * 2 Checklist (every item OK / Issue / N/A, saved as you go — inspection-draft.ts; the Aerial
 * fold once above it, plain; no repair picker), 3 Findings (ONE note — the closing_notes box
 * moved here, step 6 is not shown — the Recommend repairs / Recommend a new roof switches, an
 * optional photo roll, "Nothing to add"), 4 Materials (Nothing used pre-set: never blocks),
 * 5 Time (required), 6 Signature (optional: "Optional for an inspection", never a gap). Photos
 * are optional everywhere on an inspection. The same StepCard / StepStrip / Next step mechanics,
 * the same server-side gap list ("The checklist is not saved yet"; owner, Oct 26: only a problem
 * needs a status or a note, so no row is ever "unanswered") and Complete anyway for managers. Leak, warranty, SCOPE and other keep the seven repair steps (the owner did not say
 * otherwise for scope).
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ClipboardCheck,
  ClipboardList,
  Hammer,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  MapPinCheck,
  Minus,
  Package,
  PenLine,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { isOffice, managesTickets } from "@/lib/access";
// Phase 2 of the documents (Oct 26): who sees the Inspection report button (documents_access()).
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
  listServiceJobMaterials,
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
  myClock,
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
import { HistoryLink } from "@/components/service/site-history";
import { CrewBox } from "@/components/service/crew-box";
import { crewQuestionPending } from "@/lib/service-crew";
import { MaterialsSection } from "@/components/service/materials-section";
import { PurchaseOrdersSection } from "@/components/service/purchase-orders-section";
import { TicketExtras } from "@/components/service/ticket-extras";
import {
  NothingToAddButton,
  NothingToAddMark,
  InspectionChecklistStep,
  InspectionFindingsStep,
} from "@/components/service/inspection-closeout";
import { useInspectionCamera } from "@/components/service/inspection-camera";
import { clearInspectionDraft, useInspectionDraft } from "@/components/service/inspection-draft";
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
import {
  CLOSEOUT_ADD_MISSING,
  completeGaps,
  type CheckRead,
  type CompleteGaps,
} from "@/lib/closeout-check";
import { CLOSEOUT_TEXT_FIELDS, mergeSaved } from "@/lib/job-cache";
import {
  PHASE_PHOTO_ROLES,
  needsFor,
  repairSummary,
  type RepairPhase,
} from "@/lib/closeout-repairs";
import {
  findingsBlank,
  countMaterialItems,
  finishStepLabel,
  firstOpenStep,
  isInspection,
  lockedLine,
  nextStep,
  nextStepLabel,
  nothingUsedKey,
  notesSkippedKey,
  shownOpenStep,
  stepHeadline,
  stepMissing,
  stepOf,
  stepStatus,
  stepStatuses,
  stepSummary,
  type CloseoutStep,
  type StepId,
  type StepState,
  type StepStatus,
} from "@/lib/closeout-steps";
import { isFlagged, issueCountText, unattachedTicketPhotos } from "@/lib/inspection";
import { officeStageMessage } from "@/lib/office-stage-message";
import { pressLine, runningLabel } from "@/lib/tech-clock";
import {
  clock,
  coarsePointer,
  errText,
  fieldKeys,
  localYmd,
  loudError,
  removeFromServiceBucket,
  takePickedFiles,
  uploadToServiceBucket,
  useAutosave,
  useSignedUrl,
  whenShort,
} from "@/components/service/field-utils";
import { shouldMarkUpAfterShot, type QueuedPicture } from "@/lib/photo-upload-queue";
import {
  NO_SELECTION,
  enterSelect,
  pruneSelect,
  toggleSelect,
  type SelectState,
} from "@/lib/photo-select";
import { usePictures } from "@/components/service/picture-queue";
import {
  AfterShotEditor,
  PendingThumbs,
  UploadBadge,
  WaitingForSignalLine,
  type FreshShot,
} from "@/components/service/picture-queue-ui";
import { PhotoSelectBar } from "@/components/service/photo-select-bar";

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

// The phone's marks: "Nothing used on this ticket" (step 4) and "Skip — nothing to add" (step 6;
// owner, Oct 9). No column holds either, so each lives in localStorage per ticket like the text
// draft (closeout-steps.ts nothingUsedKey / notesSkippedKey). They record nothing on the server;
// they only mark the step done (Next step then enables), and Complete clears them.
function readMark(key: string): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeMark(key: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Storage blocked (private mode): the mark lives only in this screen.
  }
}
const readNothingUsed = (id: string) => readMark(nothingUsedKey(id));
const writeNothingUsed = (id: string, on: boolean) => writeMark(nothingUsedKey(id), on);
const clearNothingUsed = (id: string) => writeNothingUsed(id, false);
const readNotesSkipped = (id: string) => readMark(notesSkippedKey(id));
const writeNotesSkipped = (id: string, on: boolean) => writeMark(notesSkippedKey(id), on);
const clearNotesSkipped = (id: string) => writeNotesSkipped(id, false);

const orNull = (s: string) => (s.trim() ? s.trim() : null);
const FINISHED = ["done", "authorized", "invoiced", "closed"];
const asStage = (s: string): ServiceStage =>
  (SERVICE_STAGES as readonly string[]).includes(s) ? (s as ServiceStage) : "open";

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
        {/* What happened here before (owner, Oct 21): a tap opens the ticket's History fold. */}
        {job.site_id && <HistoryLink jobId={job.id} whenNone="say" />}
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

/**
 * A step's body. Plain (owner, Oct 9: "we have a box in a box here and it looks a bit awkward and
 * cramped"): the step card (StepCard) draws the border, the icon, the title and the aside; this
 * only names the region.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      {children}
    </section>
  );
}

/** The element a step's heading scrolls to (the strip, the sticky bar and the Next step button). */
const stepAnchor = (id: StepId) => `closeout-step-${id}`;
function jumpTo(id: StepId) {
  document.getElementById(stepAnchor(id))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
}

/**
 * The step strip under the header, one line (owner, Oct 9: "having all the steps listed above
 * the forms takes up a lot of space"): "Step 3 of 7 · The work" on the left, seven numbered dots
 * on the right — done ones filled with a tick, the current one primary, locked ones muted with a
 * lock — each a tap that scrolls to its step (a locked one does nothing; its title says what
 * unlocks it). The chevron opens the full list (one line per step, the locked ones with their
 * unlock line) for anyone who wants it; closed by default, nothing remembered. Not sticky.
 */
function StepStrip({
  statuses,
  open,
  serviceType,
}: {
  statuses: { step: CloseoutStep; status: StepStatus }[];
  open: StepId | null;
  /** The ticket's type: the inspection flow has six steps, the repair flow seven. */
  serviceType: string;
}) {
  const [listOpen, setListOpen] = useState(false);
  return (
    <nav aria-label="Close-out steps" className="rounded-xl border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {stepHeadline(open, serviceType)}
        </p>
        <ol className="flex items-center gap-1" aria-label="Jump to a step">
          {statuses.map(({ step, status }) => (
            <li key={step.id}>
              <button
                type="button"
                aria-current={status === "current" ? "step" : undefined}
                aria-disabled={status === "locked" || undefined}
                aria-label={`Step ${step.n} of ${statuses.length}: ${step.title}${
                  status === "locked" ? ` — locked: ${step.unlocks}` : ""
                }`}
                title={status === "locked" ? `Locked — ${step.unlocks}` : step.title}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  status === "current"
                    ? "bg-primary text-primary-foreground"
                    : status === "done"
                      ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950"
                      : "cursor-default bg-muted text-muted-foreground/70"
                }`}
                onClick={() => status !== "locked" && jumpTo(step.id)}
              >
                {status === "done" ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : status === "locked" ? (
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  step.n
                )}
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          aria-expanded={listOpen}
          aria-label={listOpen ? "Hide the step list" : "Show all steps"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40"
          onClick={() => setListOpen((v) => !v)}
        >
          {listOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {listOpen && (
        <ol className="mt-2 space-y-0.5 border-t pt-2">
          {statuses.map(({ step, status }) => (
            <li key={step.id}>
              <button
                type="button"
                disabled={status === "locked"}
                aria-current={status === "current" ? "step" : undefined}
                className={`flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-sm leading-tight ${
                  status === "current"
                    ? "bg-primary/10 font-semibold text-primary"
                    : status === "done"
                      ? "hover:bg-muted/40"
                      : "text-muted-foreground/70"
                }`}
                onClick={() => jumpTo(step.id)}
              >
                {status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : status === "locked" ? (
                  <Lock className="h-4 w-4 shrink-0" />
                ) : (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {step.n}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={status === "current" ? "block" : "block truncate"}>
                    {status === "current" ? step.title : `${step.n}. ${step.title}`}
                  </span>
                  {status === "locked" && (
                    <span className="block truncate text-xs font-normal">{step.unlocks}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

/**
 * The step IS the card (owner, Oct 9: "we have a box in a box here and it looks a bit awkward and
 * cramped even on subsequent steps"): one bordered card per step. Its header row is the step
 * number (a tick once done), the section's icon and the title — "2 · Before" — with the aside on
 * the right ("0 of 1 done", "3 items"); the body renders plain inside. The current step has a
 * primary border and a left accent bar, not a ring. A locked step is one muted line saying which
 * step to finish first. A done step that is not current folds to its header and a one-line
 * summary (closeout-steps.ts stepSummary) with Edit ("can we have each step minimize after
 * completion"); `expanded` / `onToggle` are the form's per-step state, and a step that becomes
 * current again is never folded. The current card ends in the "Next step: <title>" button
 * (owner, Oct 9: "a go to next step button at the bottom" instead of auto-advancing): enabled
 * when `missing` is null (the step's rule holds), else disabled over the `missing` line that says
 * what to do; `onNext` is the form's move. Signature has no next step (the Complete bar follows
 * it), so it gets no button.
 */
function StepCard({
  id,
  status,
  open,
  serviceType,
  icon: Icon,
  aside,
  summary,
  expanded,
  onToggle,
  missing,
  onNext,
  footer,
  beside,
  children,
}: {
  id: StepId;
  status: StepStatus;
  open: StepId | null;
  /** The ticket's type (closeout-steps.ts closeoutSteps): which list numbers and orders the steps. */
  serviceType: string;
  icon: typeof Wrench;
  aside?: React.ReactNode;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  /** What this step still needs (closeout-steps.ts stepMissing); null once its rule holds. */
  missing: string | null;
  onNext: () => void;
  /** A small thing beside the missing line under Next (the Findings step's "Nothing to add" mark). */
  footer?: React.ReactNode;
  /** A button beside Next, as big as it (the Findings step's "Nothing to add"; owner, Oct 28). */
  beside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const step = stepOf(id, serviceType);
  const nextLabel = nextStepLabel(id, serviceType);
  if (status === "locked")
    return (
      <p
        id={stepAnchor(id)}
        className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
      >
        <Lock className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">
            {step.n} · {step.title}
          </span>{" "}
          · {lockedLine(open, serviceType)}
        </span>
      </p>
    );
  const folded = status === "done" && !expanded;
  return (
    <section
      id={stepAnchor(id)}
      aria-label={`Step ${step.n} · ${step.title}`}
      className={`scroll-mt-3 rounded-xl border bg-card ${
        status === "current" ? "border-l-4 border-primary" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          {status === "done" ? (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950"
              aria-label={`Step ${step.n}, done`}
            >
              <Check className="h-4 w-4" aria-hidden />
            </span>
          ) : (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
              aria-label={`Step ${step.n}`}
            >
              {step.n}
            </span>
          )}
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{step.title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          {aside}
          {status === "done" && (
            <Button
              type="button"
              variant={folded ? "outline" : "ghost"}
              size="sm"
              className="h-9"
              aria-expanded={!folded}
              onClick={onToggle}
            >
              {folded ? (
                <>
                  <Pencil className="mr-1 h-4 w-4" /> Edit
                </>
              ) : (
                <>
                  <ChevronUp className="mr-1 h-4 w-4" /> Done
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      {folded ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-3 px-4 pb-4">{children}</div>
      )}
      {status === "current" && nextLabel !== null && (
        <div className="space-y-1.5 border-t px-4 py-3">
          <div className="flex gap-2" data-line="step-buttons">
            {beside}
            <Button
              type="button"
              className="h-12 min-w-0 flex-1 text-base font-semibold"
              disabled={missing !== null}
              aria-describedby={missing !== null ? `${stepAnchor(id)}-missing` : undefined}
              onClick={onNext}
            >
              <span className="truncate">{nextLabel}</span>{" "}
              <ArrowRight className="ml-2 h-5 w-5 shrink-0" aria-hidden />
            </Button>
          </div>
          {(missing !== null || footer) && (
            <div
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
              data-line="step-footer"
            >
              {missing !== null && (
                <p id={`${stepAnchor(id)}-missing`} className="text-muted-foreground">
                  {missing}
                </p>
              )}
              {footer}
            </div>
          )}
        </div>
      )}
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
  const clockFn = useServerFn(myClock);
  // My clock (owner, Oct 15): the line near the top while it runs on THIS ticket, and what
  // Complete closes. Fresh every minute, like My tickets.
  const clockQ = useQuery({
    queryKey: fieldKeys.clock,
    queryFn: () => clockFn(),
    enabled: !!session,
    refetchInterval: 60_000,
  });
  const clockHere = clockQ.data && clockQ.data.service_job_id === job.id ? clockQ.data : null;
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const leave = useMutation({
    mutationFn: async () =>
      // The toast says what the server did (its report), not what the cached clock promised.
      await statusFn({ data: { id: job.id, to: "leave", day: localYmd() } }),
    onSuccess: ({ transition, warning }) => {
      toast.success(pressLine(transition, "leave", job));
      if (warning) toast.warning(warning);
      for (const k of [
        fieldKeys.clock,
        fieldKeys.today,
        fieldKeys.time(job.id),
        fieldKeys.job(job.id),
        fieldKeys.events(job.id),
      ])
        void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => loudError("The clock did not stop", e),
  });

  const [stored] = useState<TextDraft | null>(() => readDraft(job.id));
  const [draft, setDraft] = useState<TextDraft>(() => stored ?? fromJob(job));
  const latest = useRef(draft);
  // Owner, Oct 12: an inspection takes its own six steps (closeout-steps.ts closeoutSteps); its
  // checklist draft saves as it is answered (inspection-draft.ts) and its photos have their own
  // camera (inspection-closeout.tsx). Both hooks run on every ticket, idle on a repair.
  const inspection = isInspection(job.service_type);
  const insp = useInspectionDraft(job, { enabled: inspection });
  const inspCamera = useInspectionCamera(job.id);

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
      // An inspection's checklist waiting on its autosave goes first (the server checks it).
      if (inspection) await insp.saveNow();
      const row = await saveFn({ data: input(latest.current) });
      // Already finished and stamped: nothing more to record. A ticket the office set Done /
      // Invoiced / Closed from the stage picker is still stamped here (owner, Oct 5: #6004).
      if (FINISHED.includes(row.stage) && row.completed_at) return row;
      // The phone's own calendar day: the labor entry's date (not UTC's day).
      const r = await statusFn({ data: { id: job.id, to: "done", day: localYmd() } });
      if (r.warning) toast.warning(r.warning);
      return r.row;
    },
    onSuccess: (row) => {
      // The stage and the stamps changed too: the whole row, then a re-read (invalidated below).
      qc.setQueryData<ServiceJobWithTech>(fieldKeys.job(job.id), (old) =>
        old ? { ...old, ...row } : old,
      );
      clearDraft(job.id);
      clearNothingUsed(job.id);
      clearNotesSkipped(job.id);
      clearInspectionDraft(job.id);
      for (const k of [
        fieldKeys.today,
        fieldKeys.clock,
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
  // The labor Complete adds itself (closeout-check.ts, closeout-steps.ts): a labor clock running
  // on this ticket, or — no clock, still "on site" from the buttons of before Oct 8 — the On site
  // stamp. Never a stamp left by a clock already closed (Leave site wrote that labor).
  const onSiteAt = clockHere
    ? clockHere.kind === "labor"
      ? clockHere.started_at
      : null
    : job.field_status === "on_site"
      ? job.on_site_at
      : null;
  // Owner, Oct 12 (item 7): "Complete anyway" is a manager's (managesTickets, the server's rule
  // in setFieldStatus); a technician sees the list with Complete disabled until it is whole.
  const manager = managesTickets(profile);

  // M2 (owner, Oct 5): Complete first lists what is missing — a repair without its Before /
  // After photo, no time, no signature (not the notes: skippable, owner Oct 9) — with "Go back"
  // and, for a manager, "Complete anyway". The same queries (and cache) the Repairs section reads.
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
      // Labor from the clock on this ticket (or an older ticket's On site stamp) is added by
      // Complete itself (onSiteAt above).
      on_site_at: onSiteAt,
      ...reads,
      // An inspection (owner, Oct 12): its checklist, answered and saved, stands where the
      // repairs do; no photo or signature is a gap.
      ...(inspection
        ? {
            checklist: { data: insp.data ? insp.items : undefined, error: insp.error },
            checklist_saved: insp.saved,
          }
        : {}),
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

  // Owner, Oct 9: the close-out is seven steps that unlock in order (closeout-steps.ts). Their
  // state comes from the ticket row, the reads above, the ticket's materials and this phone's
  // "Nothing used" mark (no column for it: localStorage per ticket, like the text draft).
  const materialsFn = useServerFn(listServiceJobMaterials);
  const materialsQ = useQuery({
    queryKey: fieldKeys.materials(job.id),
    queryFn: () => materialsFn({ data: { id: job.id } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  // The marks only make their step done; the tech still presses Next step (owner, Oct 9).
  const [nothingUsed, setNothingUsed] = useState(() => readNothingUsed(job.id));
  const markNothingUsed = (on: boolean) => {
    setNothingUsed(on);
    writeNothingUsed(job.id, on);
  };
  // Step 6's "Skip — nothing to add" (owner, Oct 9): the same kind of mark.
  const [notesSkipped, setNotesSkipped] = useState(() => readNotesSkipped(job.id));
  const markNotesSkipped = (on: boolean) => {
    setNotesSkipped(on);
    writeNotesSkipped(job.id, on);
  };
  const stepState: StepState = {
    finished,
    crewAnswered: !waiting,
    serviceType: job.service_type,
    repairs: repairsQ.data ?? [],
    photos: photosQ.data ?? [],
    materialsTouched: (materialsQ.data ?? []).length > 0 || nothingUsed,
    timeHours: (timeQ.data ?? []).reduce((sum, r) => sum + Number(r.hours), 0),
    onSiteAt,
    // The draft, not the saved row: a save that failed on the roof must not lock the signature.
    closingNotes: draft.closing_notes,
    notesSkipped,
    signaturePath: job.signature_path,
    // The folded steps' summaries (stepSummary): helper_count follows the named crew
    // (service-crew.ts helperCountFor), the items are the ledger's distinct cells, net.
    crewOthers: job.helper_count,
    materialItems: countMaterialItems(materialsQ.data ?? []),
    signedBy: draft.signed_by,
    // The inspection flow's steps (owner, Oct 12): the checklist draft and its saved state, the
    // two recommendations (the roof one is the text draft's, as on a repair). Oct 28 (owner: a
    // press on Recommend repairs "jumped the screen around … locked the additional findings step
    // and took me back to the checklist"): that answer lives in the same saved record as the
    // checklist, so while its save was in flight the checklist read "not saved" and the later
    // steps locked. The step is done once the server holds a record and the last save did not
    // fail — a save on its way never locks anything; Complete flushes it (insp.saveNow).
    checklist: insp.items,
    checklistSaved: insp.hasRecord && insp.state !== "error",
    recommendRepairs: insp.recommendRepairs,
    recommendNewRoof: draft.recommend_new_roof,
  };
  const open = firstOpenStep(stepState);
  // Until the reads answer every list is empty, so the strip would say Before with the rest
  // locked and then jump: the steps wait for the first answers (a failed read counts — its
  // section says so, loudly). An inspection waits for its checklist too.
  const ready = ![repairsQ, photosQ, timeQ, materialsQ].some((q) => q.isLoading) && !insp.loading;
  // Owner, Oct 9 ("instead of auto swapping to the next step it should have a go to next step
  // button at the bottom"): the step the tech is ON. Set once from the first open step when the
  // reads settle, then moved only by the Next step button and the bar's Finish step N — never by
  // the data, so a step whose rule holds stays current until they press Next (closeout-steps.ts
  // shownOpenStep). Component state, nothing remembered.
  const [onStep, setOnStep] = useState<StepId | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    setOnStep(open);
  }, [ready, open]);
  // Go to a step: the card is current (expanded) before the scroll measures it, so the heading
  // lands at the top with the step just left already folded.
  const goTo = (id: StepId) => {
    flushSync(() => setOnStep(id));
    jumpTo(id);
  };
  const goNext = (id: StepId) => {
    const next = nextStep(id, job.service_type);
    if (next) goTo(next);
  };
  const shownOpen = shownOpenStep(open, onStep, job.service_type);
  const statuses = stepStatuses(stepState, shownOpen);
  const status = (id: StepId) => stepStatus(id, stepState, shownOpen);
  // Owner, Oct 9: a done step folds to its summary unless Edit was pressed on it. Component
  // state, nothing remembered; cleared whenever the shown open step moves, so a step just
  // finished folds once the tech presses Next step, and a step that reopened (its Before photo
  // deleted) is current — never folded. Edit on a folded step expands it in place; it does not
  // move onStep.
  const [editing, setEditing] = useState<Partial<Record<StepId, boolean>>>({});
  useEffect(() => setEditing({}), [shownOpen]);
  const card = (id: StepId) => ({
    id,
    status: status(id),
    open: shownOpen,
    serviceType: job.service_type,
    summary: stepSummary(id, stepState),
    expanded: editing[id] === true,
    onToggle: () => setEditing((e) => ({ ...e, [id]: !e[id] })),
    missing: stepMissing(id, stepState),
    onNext: () => goNext(id),
  });
  // The header asides: what each step holds, from the same reads the rules use.
  const repairRows = repairsQ.data ?? [];
  const workDone = repairRows.filter(
    (r) =>
      needsFor(
        "work",
        repairSummary(
          r,
          (photosQ.data ?? []).filter((p) => p.repair_id === r.id),
        ).needs,
      ).length === 0,
  ).length;
  const materialItems = stepState.materialItems;
  // No toast and no scroll when a step's rule starts to hold: pressing Next step is the tech's
  // own move and its own feedback (owner, Oct 9).
  // The sticky bar completes only from step 7; before that it names the step to finish and
  // takes the tech there (goTo: the card is current and expanded when the scroll lands). The
  // real open step, not the shown one: once the data is complete the bar says Complete even
  // while the tech is still on an earlier step.
  const stepToFinish = open === null || open === "signature" ? null : open;
  const camera = useRepairCamera(job.id);
  const photoRows = photosQ.data ?? [];

  return (
    <div className="space-y-5">
      {/* The clock on this ticket (owner, Oct 15): where it stands and Leave site; Complete
          below clocks out too. */}
      {clockHere && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-primary/50 bg-primary/5 px-4 py-3"
          data-line="closeout-clock"
        >
          <p className="flex items-center gap-2 font-semibold">
            <MapPinCheck className="h-5 w-5 shrink-0 text-primary" />
            {runningLabel(
              clockHere,
              new Date(Math.max(tick, new Date(clockHere.started_at).getTime())),
              clockHere,
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={leave.isPending || busy}
            onClick={() => leave.mutate()}
          >
            {leave.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            Leave site
          </Button>
        </div>
      )}
      <StepStrip statuses={statuses} open={shownOpen} serviceType={job.service_type} />

      {/* Step 1 · Who is here: the crew gate (owner, Sep 30) — nothing else renders until it is
          answered. The card's own line says so; no second paragraph under it. Not on an
          inspection (owner, Oct 28): its flow has no crew step and nothing waits on one. */}
      {!inspection && (
        <StepCard {...card("crew")} icon={Users}>
          <CrewBox job={job} embedded />
        </StepCard>
      )}

      {waiting && !inspection ? null : !ready ? (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the ticket…
        </p>
      ) : (
        <>
          {camera.inputs}
          {inspCamera.inputs}

          {inspection ? (
            <>
              {/* Step 2 · Checklist (an inspection; owner, Oct 12): the Aerial fold once, then
                  every item as one compact line — flag only what has a problem (owner, Oct 26);
                  a flagged item opens to its note and pictures — saved as you go. No repair
                  picker. */}
              <StepCard
                {...card("checklist")}
                icon={ClipboardCheck}
                aside={
                  insp.items.length > 0 ? (
                    <span>{issueCountText(insp.items.filter(isFlagged).length)}</span>
                  ) : undefined
                }
              >
                <InspectionChecklistStep
                  job={job}
                  draft={insp}
                  photos={photoRows}
                  camera={inspCamera}
                />
              </StepCard>

              {/* Step 2 · Additional findings (compact since Oct 28, owner: "a better more
                  efficient layout" on the phone): the notes box with the camera beside its
                  heading, the two recommendations side by side, Inspected / Grade on tight rows.
                  "Nothing to add" is a button as big as Next, beside it, while the step is blank
                  (owner: the checklist usually holds every issue, so skipping is common); pressed,
                  the mark with Undo under the buttons. The Inspection report button lives in the
                  header's Documents dialog (ticket-header-actions.tsx), not here. */}
              <StepCard
                {...card("findings")}
                icon={ClipboardList}
                beside={
                  <NothingToAddButton
                    skipped={notesSkipped}
                    onSkip={markNotesSkipped}
                    blank={findingsBlank(stepState, unattachedTicketPhotos(photoRows).length)}
                  />
                }
                footer={<NothingToAddMark skipped={notesSkipped} onSkip={markNotesSkipped} />}
              >
                <InspectionFindingsStep
                  job={job}
                  draft={insp}
                  notes={draft.closing_notes}
                  onNotes={(v) => update({ closing_notes: v })}
                  recommendRepairs={insp.recommendRepairs}
                  onRecommendRepairs={insp.setRecommendRepairs}
                  recommendNewRoof={draft.recommend_new_roof}
                  onRecommendNewRoof={(v) => update({ recommend_new_roof: v })}
                  photos={photoRows}
                  camera={inspCamera}
                />
              </StepCard>
            </>
          ) : (
            <>
              {/* Step 2 · Before: the Inspection checklist (Inspection tickets) and the Aerial markup,
              then the repairs — pick them, take each one's Before photo. */}
              <StepCard
                {...card("before")}
                icon={Wrench}
                aside={repairRows.length > 0 ? <span>{repairRows.length} added</span> : undefined}
              >
                <TicketExtras job={job} canEdit />
                <RepairsSection
                  jobId={job.id}
                  ticketNumber={job.number}
                  phase="before"
                  camera={camera}
                />
              </StepCard>

              {/* Step 3 · The work: what was wrong and what was done for each repair, then its After
              photo. */}
              <StepCard
                {...card("work")}
                icon={Hammer}
                aside={
                  repairRows.length > 0 ? (
                    <span>
                      {workDone} of {repairRows.length} done
                    </span>
                  ) : undefined
                }
              >
                <RepairsSection
                  jobId={job.id}
                  ticketNumber={job.number}
                  phase="work"
                  camera={camera}
                />
              </StepCard>
            </>
          )}

          {/* Step 4 · Materials, the purchase orders (material bought for the job; never the
              Approved toggle here) and, with nothing logged, the "Nothing used" mark. Not on an
              inspection (owner, Oct 28): its flow has no materials step. */}
          {!inspection && (
            <StepCard
              {...card("materials")}
              icon={Package}
              aside={
                materialItems > 0 ? (
                  <span>
                    {materialItems} {materialItems === 1 ? "item" : "items"}
                  </span>
                ) : undefined
              }
            >
              <MaterialsSection jobId={job.id} />
              {/* (c2) Purchase orders: material bought for the job (never the Approved toggle here) */}
              <PurchaseOrdersSection jobId={job.id} field />
              {(materialsQ.data ?? []).length === 0 &&
                (nothingUsed ? (
                  <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border px-4 py-1 text-sm">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      Nothing used on this ticket
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-10"
                      onClick={() => markNothingUsed(false)}
                    >
                      Undo
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full text-base"
                    onClick={() => markNothingUsed(true)}
                  >
                    Nothing used on this ticket
                  </Button>
                ))}
            </StepCard>
          )}

          {/* Step 5 · Time (step 3 of an inspection) */}
          <StepCard
            {...card("time")}
            icon={Clock}
            aside={
              stepState.timeHours > 0 ? (
                <span>{Number(stepState.timeHours.toFixed(2))} h</span>
              ) : undefined
            }
          >
            <Section title="Time">
              {onSiteAt && !finished && (
                <p className="text-sm text-muted-foreground" data-line="labor-from-clock">
                  {clockHere
                    ? `Your clock here (on site since ${clock(onSiteAt)}) is logged as labor when you press Complete — or Leave site at the top.`
                    : `Labor from On site (${clock(onSiteAt)}) until now is added when you press Complete.`}
                </p>
              )}
              <TimeEntries
                jobId={job.id}
                editable
                defaultHelpers={job.helper_count}
                suggestTravel
              />
            </Section>
          </StepCard>

          {/* Step 6 · Notes — skippable (owner, Oct 9: "kind of redundant" after each repair's
              What was wrong / What you did). The button shows only while the notes are blank;
              pressed, a ticked line with Undo. Checked in / out with and the roof switch stay
              optional. Not on an inspection (owner, Oct 12): its one notes box is step 3's
              Findings, and the roof switch sits there too. */}
          {!inspection && (
            <StepCard {...card("notes")} icon={ClipboardList}>
              <Section title="Notes">
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
                {!draft.closing_notes.trim() &&
                  (notesSkipped ? (
                    <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border px-4 py-1 text-sm">
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Skipped — nothing to add
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10"
                        onClick={() => markNotesSkipped(false)}
                      >
                        Undo
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full text-base"
                      onClick={() => markNotesSkipped(true)}
                    >
                      Skip — nothing to add
                    </Button>
                  ))}
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
            </StepCard>
          )}

          {/* Step 7 · Signature (step 6 of an inspection, where it is optional — owner, Oct 12:
              never a gap; Next / Complete do not wait for it). */}
          <StepCard
            {...card("signature")}
            icon={PenLine}
            aside={
              job.signature_path ? (
                <span>Signed</span>
              ) : inspection ? (
                <span>Optional</span>
              ) : undefined
            }
          >
            <Section title="Signature">
              {inspection && (
                <p className="text-sm text-muted-foreground" data-line="signature-optional">
                  Optional for an inspection — take it when the customer is there; Complete does not
                  wait for it.
                </p>
              )}
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
          </StepCard>

          {/* Complete (the rest saves itself): from step 7 only; before that the bar names the
              step to finish and a tap scrolls there. */}
          <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="mb-2 flex min-h-4 items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Everything saves as you go.</span>
              <SavedIndicator state={autosave.state} />
            </div>
            <Button
              type="button"
              variant={stepToFinish ? "secondary" : "default"}
              className="h-14 w-full text-lg font-semibold"
              disabled={busy}
              onClick={stepToFinish ? () => goTo(stepToFinish) : pressComplete}
            >
              {complete.isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : stepToFinish ? (
                <Lock className="mr-2 h-5 w-5" />
              ) : (
                <CheckCircle2 className="mr-2 h-5 w-5" />
              )}
              {stepToFinish
                ? finishStepLabel(stepToFinish, job.service_type)
                : finished
                  ? "Finish"
                  : "Complete"}
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
              {!manager && (
                <p className="text-sm text-muted-foreground" data-line="add-missing">
                  {CLOSEOUT_ADD_MISSING}
                </p>
              )}
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
                {manager ? (
                  <AlertDialogAction
                    className="h-12"
                    onClick={() => {
                      setMissing([]);
                      complete.mutate();
                    }}
                  >
                    Complete anyway
                  </AlertDialogAction>
                ) : (
                  <Button
                    type="button"
                    className="h-12"
                    disabled
                    title={missing.join("; ")}
                    data-action="complete-blocked"
                  >
                    Complete
                  </Button>
                )}
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
const ROLE_WORD: Record<PhotoRole, string> = { before: "Before", after: "After" };

/**
 * The repairs, in one of the two steps they span (owner, Oct 9, closeout-steps.ts): "before" is
 * step 2 — the picker, each repair's row with its Before camera, Remove; "work" is step 3 — the
 * same repairs with What was wrong, What you did to fix it and the After camera. Both read the
 * same cached
 * rows and share the one camera (useRepairCamera, held by the form).
 */
function RepairsSection({
  jobId,
  ticketNumber,
  phase,
  camera,
}: {
  jobId: string;
  ticketNumber: number;
  phase: RepairPhase;
  camera: RepairCamera;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const before = phase === "before";
  const repairsFn = useServerFn(listJobRepairs);
  const photosFn = useServerFn(listJobPhotos);
  const recentFn = useServerFn(recentRepairsForJob);
  const templatesFn = useServerFn(listRepairTemplates);
  const saveFn = useServerFn(saveJobRepair);

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
  // The picker's reads belong to step 2 only.
  const recent = useQuery({
    queryKey: ["repair-templates-recent", jobId],
    queryFn: () => recentFn({ data: { id: jobId } }),
    enabled: !!session && before,
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
    enabled: !!session && before,
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
    enabled: !!session && before && q.length >= 2,
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

  // The ticket's usual repairs are not re-fetched per chip: hide the ones outside it here.
  const recentRows = (recent.data ?? []).filter((t) => repairMatchesTag(t.tags, tag));
  const recentIds = new Set(recentRows.map((t) => t.id));
  const favRows = (favs.data ?? []).filter((t) => !recentIds.has(t.id));
  const rows = repairs.data ?? [];
  const allPhotos = photos.data ?? [];
  const openId = rows.length === 1 ? (rows[0]?.id ?? null) : expanded;
  const showPicker = before && (rows.length === 0 || pickerOpen);
  // Owner, Oct 9 (S5): two characters typed → the matches sit right under the box and the
  // chips are out of the way (they used to grow to the full list while typing).
  const searching = q.length >= 2;
  const chipRows = allChips ? favRows : favRows.slice(0, PICKER_CHIPS);

  // The step card (closeout.tsx CloseoutForm) carries the heading and the "N added" / "N of N
  // done" aside; this is the body.
  return (
    <Section title={before ? "Repairs" : "The work"}>
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
      {!before && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No repairs on the ticket — add them in step 2.
        </p>
      )}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) =>
            openId === r.id ? (
              <RepairCard
                key={r.id}
                jobId={jobId}
                ticketNumber={ticketNumber}
                repair={r}
                phase={phase}
                photos={allPhotos.filter((p) => p.repair_id === r.id)}
                onCollapse={rows.length > 1 ? () => setExpanded(null) : null}
                camera={camera.controls(r)}
              />
            ) : (
              <RepairRow
                key={r.id}
                repair={r}
                phase={phase}
                photos={allPhotos.filter((p) => p.repair_id === r.id)}
                onOpen={() => setExpanded(r.id)}
                camera={camera.controls(r)}
              />
            ),
          )}
        </div>
      )}

      {before && !showPicker && (
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
  /**
   * This repair's pictures in flight (the portal's one queue): going up, waiting for signal, or
   * failed with Retry / Discard — the badge and the placeholders in the strip.
   */
  pending: QueuedPicture[];
  onPhoto: (role: PhotoRole) => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}

/** The one camera both repair steps share (useRepairCamera): its hidden inputs and controls. */
interface RepairCamera {
  inputs: React.ReactNode;
  controls: (r: JobRepairRow) => PhotoControls;
}

/**
 * Owner, Oct 9: the camera is ONE pair of hidden file inputs, so a folded row's Before / After
 * buttons (RepairRow) and the open card share it — a tech taps a row's camera without opening the
 * card. Held by the form, since the repairs show in step 2 (Before) and step 3 (The work). `aim`
 * is the repair the next picked file goes to. Since Oct 28 every shot goes into the portal's one
 * picture queue (picture-queue.ts; the core lib/photo-upload-queue.ts): it shrinks and uploads in
 * the background, up to three at a time, while the tech carries on — a badge ("2 uploading") and
 * a grey placeholder in the strip until the row lands; a shot the signal dropped is kept on the
 * phone ("1 picture waiting for signal") and goes up on its own; a refused one is red in the
 * strip with Retry / Discard (owner, Oct 9: the file is never thrown away with the error).
 *
 * Mark up as you shoot: the inputs have `capture`, so on a phone (shouldMarkUpAfterShot; never
 * on a computer) the markup editor opens on the fresh shot (AfterShotEditor) with Skip, Done and
 * "Take another <role>" for the same repair — one tap per shot.
 */
function useRepairCamera(jobId: string): RepairCamera {
  const pictures = usePictures({ jobId });
  const beforeRef = useRef<HTMLInputElement | null>(null);
  const afterRef = useRef<HTMLInputElement | null>(null);
  const aim = useRef<string | null>(null);
  const [shot, setShot] = useState<(FreshShot & { role: PhotoRole; repairId: string }) | null>(
    null,
  );
  const takePhoto = (repairId: string, role: PhotoRole) => {
    aim.current = repairId;
    (role === "before" ? beforeRef : afterRef).current?.click();
  };
  const pick = (role: PhotoRole) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = takePickedFiles(input);
    const repairId = aim.current;
    if (!repairId || files.length === 0) return;
    const fromCamera = shouldMarkUpAfterShot({
      capture: input.getAttribute("capture"),
      coarsePointer: coarsePointer(),
    });
    const ids = pictures.add(files, { jobId, repairId, itemKey: null, role }, { fromCamera });
    const [first] = files;
    const [id] = ids;
    if (fromCamera && files.length === 1 && first && id)
      setShot({ id, file: first, label: ROLE_WORD[role], role, repairId });
  };
  const photoControls = (r: JobRepairRow): PhotoControls => ({
    pending: pictures.entries.filter((p) => p.target.repairId === r.id),
    onPhoto: (role) => takePhoto(r.id, role),
    onRetry: pictures.retry,
    onDiscard: pictures.discard,
  });

  const inputs = (
    <>
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
      {shot && (
        <AfterShotEditor
          shot={shot}
          onClose={() => setShot(null)}
          onTakeAnother={() => takePhoto(shot.repairId, shot.role)}
          attachMarks={pictures.attachMarks}
        />
      )}
    </>
  );
  return { inputs, controls: photoControls };
}

/** This repair's pictures in flight for the step's roles (the strip's placeholders, the badge). */
const pendingFor = (camera: PhotoControls, roles: readonly PhotoRole[]) =>
  camera.pending.filter((p) => (roles as readonly string[]).includes(p.target.role));

/**
 * The Before (n) / After (n) camera buttons — `roles`: the step's (step 2 Before, step 3 After;
 * closeout-repairs.ts PHASE_PHOTO_ROLES) — never disabled: the queue takes the next shot while
 * the last one goes up (a "2 uploading" badge beside them; the placeholders sit in the card's
 * strip). Under them, that role's pictures waiting for signal and the failed ones with "Retry
 * upload" / "Discard". `compact`: the folded row's size; else the card's wide buttons.
 */
function PhotoButtons({
  photos,
  camera,
  roles,
  compact,
}: {
  photos: JobPhotoRow[];
  camera: PhotoControls;
  roles: readonly PhotoRole[];
  compact?: boolean | undefined;
}) {
  const { onPhoto, onRetry, onDiscard } = camera;
  const count = (role: PhotoRole) => photos.filter((p) => p.role === role).length;
  const pending = pendingFor(camera, roles);
  const uploading = pending.filter((p) => p.status !== "held" && p.status !== "failed").length;
  const waiting = pending.filter((p) => p.status === "held").length;
  const failed = pending.filter((p) => p.status === "failed");
  return (
    <>
      <div
        className={`flex flex-wrap items-center gap-2 ${compact ? "" : "sm:grid sm:grid-cols-2"}`}
      >
        {roles.map((role) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            className={compact ? "h-10 px-3 text-sm" : "h-11 text-base"}
            onClick={() => onPhoto(role)}
          >
            <Camera className={compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} />
            {ROLE_WORD[role]}
            {count(role) ? ` (${count(role)})` : ""}
          </Button>
        ))}
        <UploadBadge n={uploading} />
      </div>
      <WaitingForSignalLine n={waiting} />
      {failed.map((p) => (
        <div
          key={p.id}
          className="flex flex-wrap items-center gap-2 text-sm"
          data-line="photo-failed"
        >
          <span className="text-destructive">
            The {ROLE_WORD[p.target.role as PhotoRole] ?? "photo"} photo did not upload
            {p.error ? `: ${p.error}` : ""}
          </span>
          <Button type="button" variant="outline" className="h-10" onClick={() => onRetry(p.id)}>
            <RefreshCw className="mr-1 h-4 w-4" /> Retry upload
          </Button>
          <Button type="button" variant="ghost" className="h-10" onClick={() => onDiscard(p.id)}>
            Discard
          </Button>
        </div>
      ))}
    </>
  );
}

/**
 * A repair folded to one line (owner, Oct 9): name, "× qty unit" and a chevron open the card;
 * under them its own camera button for the step (Before (n) in step 2, After (n) in step 3, so
 * a photo never needs the card open) beside, in amber, what the step still needs of it
 * (closeout-repairs.ts).
 */
function RepairRow({
  repair,
  phase,
  photos,
  onOpen,
  camera,
}: {
  repair: JobRepairRow;
  phase: RepairPhase;
  photos: JobPhotoRow[];
  onOpen: () => void;
  camera: PhotoControls;
}) {
  const s = repairSummary(repair, photos);
  const needs = needsFor(phase, s.needs);
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
        <PhotoButtons photos={photos} camera={camera} roles={PHASE_PHOTO_ROLES[phase]} compact />
        {needs.length > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            needs: {needs.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The open repair. In step 2 (`phase` "before"): its name (editable when typed in), quantity,
 * Remove, its Before photos and camera. In step 3 ("work"): What was wrong, What you did to fix
 * it (the columns stay problem_text / resolution_text; owner, Oct 9: "Problem" and "Work
 * completed" read like questions), its After photos and camera. Text saves when a box is left.
 */
function RepairCard({
  jobId,
  ticketNumber,
  repair,
  phase,
  photos,
  onCollapse,
  camera,
}: {
  jobId: string;
  ticketNumber: number;
  repair: JobRepairRow;
  phase: RepairPhase;
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
  // Owner, Oct 28 (fewer taps): hold a thumbnail (or Shift+click) to pick several, then Remove /
  // Download them at once (lib/photo-select.ts; the bar is photo-select-bar.tsx).
  const [sel, setSel] = useState<SelectState>(NO_SELECTION);

  const payload = (v: RepairVals) => ({
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
  });
  const landed = (row: JobRepairRow) =>
    qc.setQueryData<JobRepairRow[]>(fieldKeys.repairs(jobId), (old) =>
      old?.map((r) => (r.id === row.id ? row : r)),
    );
  const unchanged = (v: RepairVals) => JSON.stringify(v) === JSON.stringify(repairVals(repair));
  const save = useMutation({
    mutationFn: (v: RepairVals) => saveFn({ data: payload(v) }),
    onSuccess: landed,
    onError: (e) => loudError(`Could not save ${repair.name}`, e),
  });
  const commit = (next?: Partial<RepairVals>) => {
    const v = { ...vals, ...next };
    if (unchanged(v)) return;
    save.mutate(v);
  };
  // Owner, Oct 9: step 3's Next step button reads the SAVED row (closeout-steps.ts stepDone:
  // resolution_text), and on a phone a text box is not left until a tap lands elsewhere — so
  // What was wrong / What you did save a moment after typing stops (useAutosave, as the closing
  // notes do) and on blur (flush), not only when the box is left. The name and quantity (step 2)
  // still commit on blur.
  const typed = useAutosave<RepairVals>(
    async (v) => {
      if (unchanged(v)) return;
      landed(await saveFn({ data: payload(v) }));
    },
    { what: `${repair.name}'s text` },
  );
  const type = (patch: Partial<RepairVals>) => {
    const next = { ...vals, ...patch };
    setVals(next);
    typed.push(next);
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
  const before = phase === "before";
  const roles = PHASE_PHOTO_ROLES[phase];
  const shown = photos.filter((p) => (roles as readonly string[]).includes(p.role));
  const pending = pendingFor(camera, roles);
  const selection = pruneSelect(
    sel,
    shown.map((p) => p.id),
  );
  const picked = selection.ids
    .map((id) => shown.find((p) => p.id === id))
    .filter((p): p is JobPhotoRow => !!p);

  return (
    <article className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {free && before ? (
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
        {/* Owner, Oct 9: Remove sits in the header (a small ghost button), not on a row of its own;
            step 2's — a repair is taken off where it was added. */}
        {before && !confirmRemove && (
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

      {before && (
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
      )}

      {!before && (
        <>
          <div className="space-y-1">
            <Label className="text-sm" htmlFor={`${repair.id}-problem`}>
              What was wrong
            </Label>
            <Textarea
              id={`${repair.id}-problem`}
              rows={2}
              className="text-base"
              placeholder="e.g. Drain clogged with debris, water pooling"
              value={vals.problem_text}
              onChange={(e) => type({ problem_text: e.target.value })}
              onBlur={() => void typed.flush()}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm" htmlFor={`${repair.id}-resolution`}>
              What you did to fix it
            </Label>
            <Textarea
              id={`${repair.id}-resolution`}
              rows={2}
              className="text-base"
              placeholder="e.g. Cleared the drain and resealed the strainer"
              value={vals.resolution_text}
              onChange={(e) => type({ resolution_text: e.target.value })}
              onBlur={() => void typed.flush()}
            />
          </div>
        </>
      )}

      {(shown.length > 0 || pending.length > 0) && (
        <div className="flex flex-wrap gap-2" data-strip={phase}>
          {shown.map((p) => (
            <PhotoThumb
              key={p.id}
              photo={p}
              deleting={delPhoto.isPending && delPhoto.variables === p.id}
              onDelete={() => delPhoto.mutate(p.id)}
              // Tap a photo to circle the problem, add an arrow or words (owner, Oct 1).
              canAnnotate
              ticketNumber={ticketNumber}
              select={{
                on: selection.on,
                selected: selection.ids.includes(p.id),
                onPress: (how) =>
                  setSel(how === "enter" ? enterSelect(p.id) : toggleSelect(selection, p.id)),
              }}
            />
          ))}
          {/* The pictures still going up (grey, a spinner) become real thumbnails as they land. */}
          <PendingThumbs entries={pending} onRetry={camera.onRetry} onDiscard={camera.onDiscard} />
        </div>
      )}
      {selection.on && picked.length > 0 && (
        <PhotoSelectBar
          jobId={jobId}
          ticketNumber={ticketNumber}
          photos={photos}
          selected={picked}
          onClear={() => setSel(NO_SELECTION)}
        />
      )}

      <PhotoButtons photos={photos} camera={camera} roles={roles} />
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
