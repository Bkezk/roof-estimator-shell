/**
 * Inspection tickets (owner, Sep 30; rules in src/lib/inspection.ts). On a ticket of type
 * Inspection — the office ticket page here; the tech's close-out has its own cards
 * (inspection-closeout.tsx) — the checklist, saved as it is answered (inspection-draft.ts
 * useInspectionDraft; owner, Oct 12: no manual save button — the one there was got lost on
 * Complete). Owner, Oct 26: "not every part needs a comment or status, just ones with problems" —
 * each row is one compact line (ChecklistRows): a tap on the label or the flag marks it an
 * Issue, and only a flagged row opens up to its note and its pictures (the close-out's camera,
 * and "From ticket photos" — inspection-item-photos.tsx). A subtle check ticks a row OK by hand;
 * N/A stays a small toggle. A row with no status reads as OK. Under the rows: Property inspected
 * (a date, "Today" on the phone's own day) and Property grade (A–F), saved with the checklist
 * (InspectionDetails). The findings note is the ticket's closing notes (one notes box; the
 * Close-out fold shows it); an older inspection's own notes still show, read-only. Once the
 * ticket is Done the office may turn it into a repair ticket (linked back to the inspection), a
 * bid (the estimator opens with the customer, site and findings prefilled) — or press "No action
 * needed". The choice is recorded on the ticket (service_jobs.inspection_outcome) and shown as
 * "Outcome: … — by <name>, <date>". Nothing is created automatically.
 *
 * `FromInspectionNote` is the "From inspection #6012" link on a ticket created from one.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Calculator,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Flag,
  Loader2,
  Wrench,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import type { ServiceJobRow } from "@/lib/service.functions";
import { listJobPhotos } from "@/lib/service-field.functions";
import {
  createRepairFromInspection,
  getSourceInspection,
  setInspectionOutcome,
  type OutcomeRecord,
  type TicketInspection,
} from "@/lib/service-inspection.functions";
import {
  INSPECTION_GRADES,
  ITEM_NOTE_MAX,
  bidPrefillFromInspection,
  fromInspectionLabel,
  inspectedLine,
  inspectionComplete,
  inspectionSummary,
  isFlagged,
  outcomeLine,
  parseInspection,
  visibleChecklist,
  type InspectionGrade,
  type InspectionItem,
} from "@/lib/inspection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Box } from "@/components/service/field-shared";
import { LastTimeLine } from "@/components/service/site-history";
import {
  inspectionKey,
  useInspectionDraft,
  type InspectionDraftState,
} from "@/components/service/inspection-draft";
import { ItemPhotoTools } from "@/components/service/inspection-item-photos";
import { errText, fieldKeys, localYmd, whenShort } from "@/components/service/field-utils";

/** The Inspection section; only on a ticket of type Inspection. */
export function InspectionSection({
  job,
  canEdit,
  officeOrAdmin,
}: {
  job: ServiceJobRow;
  canEdit: boolean;
  officeOrAdmin: boolean;
}) {
  if (job.service_type !== "inspection") return null;
  // The row carries the saved answers: the header needs no extra fetch.
  const saved = parseInspection(job.inspection);
  return (
    <Box
      title="Inspection"
      icon={ClipboardCheck}
      collapsible
      defaultOpen
      storageKey="inspection"
      summary={saved ? inspectionSummary(visibleChecklist(saved.items)) : "not started"}
    >
      <InspectionBody job={job} canEdit={canEdit} officeOrAdmin={officeOrAdmin} />
    </Box>
  );
}

function InspectionBody({
  job,
  canEdit,
  officeOrAdmin,
}: {
  job: ServiceJobRow;
  canEdit: boolean;
  officeOrAdmin: boolean;
}) {
  const draft = useInspectionDraft(job, { enabled: true, readOnly: !canEdit });
  const { session } = useAuth();
  const photosFn = useServerFn(listJobPhotos);
  // The ticket's photos (the same key as the Photos fold): a flagged row shows its pictures and
  // offers the loose ones ("From ticket photos").
  const photos = useQuery({
    queryKey: fieldKeys.photos(job.id),
    queryFn: () => photosFn({ data: { id: job.id } }),
    enabled: !!session,
  });
  if (draft.error)
    return (
      <p className="text-sm text-destructive">
        Could not load the inspection: {errText(draft.error)}
      </p>
    );
  if (!draft.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the checklist…
      </p>
    );
  const legacyNotes = draft.data.inspection?.notes.trim() ?? "";
  return (
    <div className="space-y-3">
      <ChecklistRows
        items={draft.items}
        readOnly={!canEdit}
        onChange={draft.setItem}
        jobId={job.id}
        extra={(item: InspectionItem) => (
          <ItemPhotoTools
            jobId={job.id}
            itemKey={item.id}
            itemLabel={item.label}
            photos={photos.data ?? []}
            items={draft.items}
            ticketNumber={job.number}
            canEdit={canEdit}
          />
        )}
      />
      <InspectionDetails draft={draft} canEdit={canEdit} idPrefix={`insp-${job.id}`} />
      {legacyNotes && (
        <p className="whitespace-pre-line rounded-md bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Inspection notes: </span>
          {legacyNotes}
        </p>
      )}
      <ChecklistSavedLine draft={draft} canEdit={canEdit} />
      {officeOrAdmin && <OfficeActions job={job} data={draft.data} dirty={!draft.saved} />}
    </div>
  );
}

/**
 * The checklist rows, controlled (owner, Oct 26: "not every part needs a comment or status, just
 * ones with problems"). Each row is one compact line: the label (a tap flags it ↔ unflags it,
 * status "issue" ↔ null), a small Issue flag, a subtle OK check and an N/A toggle. Only a
 * flagged row opens up to its note ("What and where") and `extra` — the pictures: the close-out's
 * camera and thumbnails, the office's From ticket photos. A row with no status reads as OK; a row
 * ticked OK (by hand, or on an older save) shows a quiet check; N/A greys the label. Both screens
 * render the checklist with this. With `jobId`, each row ends with what an earlier ticket at this
 * property found for that item ("Last time: Jun 12 — …" and its photo; owner, Oct 21,
 * site-history.tsx LastTimeLine) — photos carry the item's id as item_key.
 */
export function ChecklistRows({
  items,
  readOnly,
  onChange,
  extra,
  jobId,
}: {
  items: readonly InspectionItem[];
  readOnly: boolean;
  onChange: (id: string, patch: Partial<InspectionItem>) => void;
  extra?: ((item: InspectionItem) => React.ReactNode) | undefined;
  /** The ticket, for the "Last time" line under each item. */
  jobId?: string | undefined;
}) {
  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        The checklist is empty. A manager or admin adds its items on Setup › Inspection checklist.
      </p>
    );
  return (
    <ol className="space-y-1.5">
      {items.map((item) => {
        const flagged = isFlagged(item);
        const ok = item.status === "ok";
        const na = item.status === "na";
        const set = (status: InspectionItem["status"]) =>
          onChange(item.id, { status: item.status === status ? null : status });
        return (
          <li
            key={item.id}
            data-row={flagged ? "issue" : (item.status ?? "clear")}
            className={`space-y-2 rounded-md border px-2 py-1 ${flagged ? "border-red-300 bg-red-50/40 dark:border-red-900/60 dark:bg-red-950/20" : ""}`}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-h-10 flex-1 items-center gap-2 rounded-md px-1 text-left font-medium disabled:cursor-default"
                aria-pressed={flagged}
                aria-label={`${item.label}: flag an issue`}
                disabled={readOnly}
                onClick={() => set("issue")}
              >
                {flagged ? (
                  <Flag
                    className="h-4 w-4 shrink-0 fill-red-600 text-red-600 dark:fill-red-400 dark:text-red-400"
                    aria-hidden
                  />
                ) : ok ? (
                  <Check
                    className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className={na ? "text-muted-foreground line-through" : ""}>{item.label}</span>
              </button>
              <div
                className="flex shrink-0 items-center gap-0.5"
                role="group"
                aria-label={`${item.label}: result`}
              >
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={ok}
                  aria-label={`${item.label}: OK`}
                  title="Tick OK (optional — a row with nothing flagged reads as OK)"
                  disabled={readOnly}
                  className={`h-9 w-9 p-0 ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/60"}`}
                  onClick={() => set("ok")}
                >
                  <Check className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={flagged}
                  aria-label={`${item.label}: issue`}
                  disabled={readOnly}
                  className={`h-9 px-2.5 ${flagged ? "border-transparent bg-red-600 text-white hover:bg-red-600/90" : ""}`}
                  onClick={() => set("issue")}
                >
                  <Flag className="mr-1 h-3.5 w-3.5" aria-hidden /> Issue
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={na}
                  aria-label={`${item.label}: not applicable`}
                  disabled={readOnly}
                  className={`h-9 px-2 text-xs ${na ? "bg-slate-600 text-white hover:bg-slate-600/90 dark:bg-slate-500" : "text-muted-foreground"}`}
                  onClick={() => set("na")}
                >
                  N/A
                </Button>
              </div>
            </div>
            {flagged ? (
              <div className="space-y-2 pb-1">
                <Input
                  aria-label={`${item.label}: note`}
                  className="h-10 text-base"
                  placeholder="What and where"
                  maxLength={ITEM_NOTE_MAX}
                  value={item.note}
                  disabled={readOnly}
                  onChange={(e) => onChange(item.id, { note: e.target.value })}
                />
                {extra?.(item)}
              </div>
            ) : (
              item.note && (
                <p className="whitespace-pre-line px-1 pb-1 text-sm text-muted-foreground">
                  {item.note}
                </p>
              )
            )}
            {jobId && <LastTimeLine jobId={jobId} itemKey={item.id} />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Property inspected and Property grade (owner, Oct 26; CenterPoint's Property Inspected /
 * Property Grade). The date starts blank; "Today" fills the phone's own calendar day
 * (field-utils.ts localYmd — never UTC's). The grade is A B C D F as segmented buttons, none
 * pressed until chosen; pressing the chosen one clears it. Both save with the checklist.
 */
export function InspectionDetails({
  draft,
  canEdit,
  idPrefix,
}: {
  draft: InspectionDraftState;
  canEdit: boolean;
  idPrefix: string;
}) {
  const dateId = `${idPrefix}-inspected-on`;
  // Oct 28 (owner: a tighter Findings step on the phone): the labels sit in the row — "Inspected"
  // with the date and Today, "Grade" with A–F — instead of a line above each.
  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6"
      data-section="inspection-details"
    >
      <div className="flex items-center gap-2">
        <Label htmlFor={dateId} className="w-[4.25rem] shrink-0 sm:w-auto">
          Inspected
        </Label>
        <Input
          id={dateId}
          type="date"
          aria-label="Property inspected"
          className="h-10 w-[150px]"
          value={draft.inspectedOn}
          disabled={!canEdit}
          onChange={(e) => draft.setInspectedOn(e.target.value)}
        />
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            className="h-10 px-3"
            onClick={() => draft.setInspectedOn(localYmd())}
          >
            Today
          </Button>
        )}
      </div>
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="Property grade"
        data-section="inspection-grade"
      >
        <span className="w-[4.25rem] shrink-0 text-sm font-medium sm:w-auto" aria-hidden>
          Grade
        </span>
        <div className="flex gap-1">
          {INSPECTION_GRADES.map((g) => (
            <GradeButton
              key={g}
              grade={g}
              active={draft.grade === g}
              disabled={!canEdit}
              onClick={() => draft.setGrade(draft.grade === g ? null : g)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GradeButton({
  grade,
  active,
  disabled,
  onClick,
}: {
  grade: InspectionGrade;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={active}
      aria-label={`Grade ${grade}`}
      disabled={disabled}
      className={`h-10 w-10 text-base font-semibold ${active ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
      onClick={onClick}
    >
      {grade}
    </Button>
  );
}

/**
 * The line under the checklist: the counts ("2 issues · 7 OK", "No issues · 9 OK"), the
 * inspected day and grade when set ("Inspected Oct 20 · Grade D"), then whether the server has
 * what is on screen — "saved <when> by <who>", "saving…", or "not saved yet" with a Save now
 * button (the autosave tries again on the next change too; this is for a tech watching the
 * signal come back — and, since Oct 26, for a roof with nothing to flag: the untouched checklist
 * is not on the server until it is sent).
 */
export function ChecklistSavedLine({
  draft,
  canEdit,
}: {
  draft: InspectionDraftState;
  canEdit: boolean;
}) {
  const rec = draft.data?.inspection;
  const savedText =
    draft.state === "saving"
      ? "saving…"
      : draft.saved
        ? rec?.saved_at
          ? `saved ${whenShort(rec.saved_at)}${rec.saved_by ? ` by ${rec.saved_by}` : ""}`
          : ""
        : "not saved yet";
  const details = inspectedLine({
    inspected_on: draft.inspectedOn || null,
    grade: draft.grade,
  });
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {inspectionSummary(draft.items)}
          {details ? ` · ${details}` : ""}
          {savedText ? ` · ${savedText}` : ""}
        </span>
        {canEdit && !draft.saved && draft.state !== "saving" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => void draft.saveNow()}
          >
            Save now
          </Button>
        )}
      </div>
      {canEdit && !draft.hasRecord && draft.state !== "saving" && (
        <p>
          Flag only what has a problem — every other row reads as OK. Nothing to flag? Save the
          checklist as it stands.
        </p>
      )}
    </div>
  );
}

type RepairType = "leak" | "warranty" | "other";
const asRepairType = (v: string): RepairType =>
  v === "warranty" ? "warranty" : v === "other" ? "other" : "leak";

/**
 * From a completed inspection: a repair ticket, a bid, or "No action needed" (the office's
 * choice; owner, Oct 12). Whichever is pressed is recorded on the ticket and shown as
 * "Outcome: Repair ticket #N / Bid <name> / No action needed — by <name>, <date>".
 */
function OfficeActions({
  job,
  data,
  dirty,
}: {
  job: ServiceJobRow;
  data: TicketInspection;
  dirty: boolean;
}) {
  const { can, profile } = useAuth();
  // A repair ticket is a new ticket: a manager's (owner, Oct 1). Create bid stays Estimate's.
  const manager = managesTickets(profile);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createFn = useServerFn(createRepairFromInspection);
  const outcomeFn = useServerFn(setInspectionOutcome);
  const [type, setType] = useState<RepairType>("leak");
  // Every ticket has a date (owner, Oct 1): the repair ticket gets its day here.
  const [date, setDate] = useState("");
  const complete = inspectionComplete(job.stage);
  const inFlight = useRef(false);
  const landedOutcome = (o: OutcomeRecord) => {
    qc.setQueryData<TicketInspection>(inspectionKey(job.id), (old) =>
      old ? { ...old, outcome: o } : old,
    );
    void qc.invalidateQueries({ queryKey: inspectionKey(job.id) });
    void qc.invalidateQueries({ queryKey: fieldKeys.job(job.id) });
    void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
  };
  const create = useMutation({
    mutationFn: () => createFn({ data: { id: job.id, service_type: type, scheduled_date: date } }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: inspectionKey(job.id) });
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
      void qc.invalidateQueries({ queryKey: fieldKeys.job(job.id) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
      const said = row.existing
        ? `This inspection already has repair ticket #${row.number}`
        : `Repair ticket #${row.number} created`;
      toast.success(said, {
        action: {
          label: "Open",
          onClick: () => void navigate({ to: "/service", search: { id: row.id } }),
        },
      });
    },
    onError: (e) => toast.error(`Could not create the repair ticket: ${errText(e)}`),
  });
  const record = useMutation({
    mutationFn: (outcome: "bid" | "none") => outcomeFn({ data: { id: job.id, outcome } }),
    onSuccess: (o) => {
      landedOutcome(o);
      if (o.outcome === "none") toast.success("Recorded: no action needed");
    },
    onError: (e) => toast.error(`Could not record the outcome: ${errText(e)}`),
  });
  const ins = data.inspection;
  const bidPrefill = ins
    ? bidPrefillFromInspection(
        {
          number: job.number,
          customer_name: job.customer_name,
          account_id: job.account_id,
          site_id: job.site_id,
          site_name: job.site_name,
          site: data.site,
        },
        // The findings note is the ticket's closing notes (one notes box, Oct 12); an older
        // inspection's own notes still win when it has them.
        { items: ins.items, notes: ins.notes.trim() || (job.closing_notes ?? "") },
      )
    : null;
  const outcome = data.outcome;
  const outcomeDetail =
    outcome?.outcome === "repair_ticket"
      ? data.created[0]
        ? `#${data.created[0].number}`
        : null
      : outcome?.outcome === "bid"
        ? (bidPrefill?.pfName ?? null)
        : null;
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
      <p className="font-medium">After the inspection</p>
      {outcome && (
        <p className="flex items-center gap-1.5 font-medium" data-line="inspection-outcome">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          {outcomeLine({
            outcome: outcome.outcome,
            detail: outcomeDetail,
            by: outcome.by,
            when: outcome.at ? whenShort(outcome.at) : null,
          })}
        </p>
      )}
      {!complete ? (
        <p className="text-muted-foreground">
          When the ticket is Done, a repair ticket or a bid can be started from it — or neither.
        </p>
      ) : !ins ? (
        <p className="text-muted-foreground">The checklist has not been saved on this ticket.</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            Only if the customer wants the work: nothing is created until you press a button.
          </p>
          {dirty && (
            <p className="text-amber-700 dark:text-amber-400">
              The checklist is still saving — a moment.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {manager && (
              <>
                <Select value={type} onValueChange={(v) => setType(asRepairType(v))}>
                  <SelectTrigger className="h-10 w-[130px]" aria-label="Repair ticket type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leak">Leak</SelectItem>
                    <SelectItem value="warranty">Warranty</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  className="h-10 w-[170px]"
                  aria-label="Repair ticket date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={dirty || create.isPending || !date}
                  onClick={() => {
                    // One request at a time, even for a double click before the re-render
                    // disables the button (the server returns the existing ticket anyway).
                    if (inFlight.current || create.isPending) return;
                    inFlight.current = true;
                    create.mutate(undefined, {
                      onSettled: () => {
                        inFlight.current = false;
                      },
                    });
                  }}
                >
                  {create.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="mr-2 h-4 w-4" />
                  )}
                  Create repair ticket
                </Button>
              </>
            )}
            {!manager && !can("estimate") && (
              <span className="text-muted-foreground">A manager creates the repair ticket.</span>
            )}
            {can("estimate") &&
              (dirty || !bidPrefill ? (
                <Button type="button" variant="outline" className="h-10" disabled>
                  <Calculator className="mr-2 h-4 w-4" /> Create bid
                </Button>
              ) : (
                <Button asChild variant="outline" className="h-10">
                  <Link
                    to="/estimate"
                    search={bidPrefill}
                    // The outcome is recorded as the estimator opens (best effort: the bid is
                    // the estimator's; a failure here is a toast, not a stop).
                    onClick={() => record.mutate("bid")}
                  >
                    <Calculator className="mr-2 h-4 w-4" /> Create bid
                  </Link>
                </Button>
              ))}
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={dirty || record.isPending || outcome?.outcome === "none"}
              onClick={() => record.mutate("none")}
            >
              {record.isPending && record.variables === "none" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              No action needed
            </Button>
          </div>
        </>
      )}
      {data.created.length > 0 && (
        <p>
          Created from this inspection:{" "}
          {data.created.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ", "}
              <Link to="/service" search={{ id: t.id }} className="underline underline-offset-2">
                #{t.number}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** "From inspection #6012" on a ticket that was created from an inspection. */
export function FromInspectionNote({ job }: { job: ServiceJobRow }) {
  const { session } = useAuth();
  const getFn = useServerFn(getSourceInspection);
  const src = job.from_job_id ?? null;
  const q = useQuery({
    queryKey: ["service-source-inspection", src],
    queryFn: () => getFn({ data: { id: src! } }),
    enabled: !!session && !!src,
    staleTime: 10 * 60_000,
  });
  if (!src) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm">
      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
      {q.data ? (
        <Link to="/service" search={{ id: q.data.id }} className="underline underline-offset-2">
          {fromInspectionLabel(q.data.number)}
        </Link>
      ) : (
        <span className="text-muted-foreground">From an inspection</span>
      )}
    </p>
  );
}
