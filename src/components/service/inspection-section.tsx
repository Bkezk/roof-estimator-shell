/**
 * Inspection tickets (owner, Sep 30; rules in src/lib/inspection.ts). On a ticket of type
 * Inspection — the office ticket page here; the tech's close-out has its own cards
 * (inspection-closeout.tsx) — the checklist (each item OK / Issue / N/A with a note), saved as it
 * is answered (inspection-draft.ts useInspectionDraft; owner, Oct 12: no manual save button —
 * the one there was got lost on Complete). The findings note is the ticket's closing
 * notes (one notes box; the Close-out fold shows it); an older inspection's own notes still show,
 * read-only. Once the ticket is Done the office may turn it into a repair ticket (linked back to
 * the inspection), a bid (the estimator opens with the customer, site and findings prefilled) —
 * or press "No action needed". The choice is recorded on the ticket (service_jobs.inspection_outcome)
 * and shown as "Outcome: … — by <name>, <date>". Nothing is created automatically.
 *
 * `FromInspectionNote` is the "From inspection #6012" link on a ticket created from one.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Calculator, CheckCircle2, ClipboardCheck, Loader2, Wrench } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import type { ServiceJobRow } from "@/lib/service.functions";
import {
  createRepairFromInspection,
  getSourceInspection,
  setInspectionOutcome,
  type OutcomeRecord,
  type TicketInspection,
} from "@/lib/service-inspection.functions";
import {
  INSPECTION_STATUSES,
  ITEM_NOTE_MAX,
  STATUS_LABELS,
  bidPrefillFromInspection,
  fromInspectionLabel,
  inspectionComplete,
  inspectionSummary,
  outcomeLine,
  parseInspection,
  visibleChecklist,
  type InspectionItem,
  type InspectionStatus,
} from "@/lib/inspection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Box } from "@/components/service/field-shared";
import {
  inspectionKey,
  useInspectionDraft,
  type InspectionDraftState,
} from "@/components/service/inspection-draft";
import { errText, fieldKeys, whenShort } from "@/components/service/field-utils";

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
      <ChecklistRows items={draft.items} readOnly={!canEdit} onChange={draft.setItem} />
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
 * The checklist rows, controlled: each item's label, OK / Issue / N/A and a note ("What and
 * where" on an Issue). `extra` renders under a row — the close-out's camera and thumbnails. Both
 * screens render the checklist with this.
 */
export function ChecklistRows({
  items,
  readOnly,
  onChange,
  extra,
}: {
  items: readonly InspectionItem[];
  readOnly: boolean;
  onChange: (id: string, patch: Partial<InspectionItem>) => void;
  extra?: ((item: InspectionItem) => React.ReactNode) | undefined;
}) {
  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        The checklist is empty. A manager or admin adds its items on Setup › Inspection checklist.
      </p>
    );
  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="space-y-2 rounded-md border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{item.label}</span>
            <div className="flex gap-1" role="group" aria-label={`${item.label}: result`}>
              {INSPECTION_STATUSES.map((s) => (
                <StatusButton
                  key={s}
                  status={s}
                  active={item.status === s}
                  disabled={readOnly}
                  onClick={() => onChange(item.id, { status: item.status === s ? null : s })}
                />
              ))}
            </div>
          </div>
          {(item.status === "issue" || item.note || !readOnly) && (
            <Input
              aria-label={`${item.label}: note`}
              className="h-10 text-base"
              placeholder={item.status === "issue" ? "What and where" : "Note"}
              maxLength={ITEM_NOTE_MAX}
              value={item.note}
              disabled={readOnly}
              onChange={(e) => onChange(item.id, { note: e.target.value })}
            />
          )}
          {extra?.(item)}
        </li>
      ))}
    </ol>
  );
}

/**
 * The line under the checklist: the counts, then whether the server has what is on screen —
 * "saved <when> by <who>", "saving…", or "not saved yet" with a Save now button (the autosave
 * tries again on the next change too; this is for a tech watching the signal come back).
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
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>
        {inspectionSummary(draft.items)}
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
  );
}

export function StatusButton({
  status,
  active,
  disabled,
  onClick,
}: {
  status: InspectionStatus;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const on =
    status === "issue"
      ? "bg-red-600 text-white hover:bg-red-600/90"
      : status === "ok"
        ? "bg-emerald-600 text-white hover:bg-emerald-600/90"
        : "bg-slate-600 text-white hover:bg-slate-600/90 dark:bg-slate-500 dark:hover:bg-slate-500/90";
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={active}
      disabled={disabled}
      className={`h-10 min-w-14 ${active ? `border-transparent ${on}` : ""}`}
      onClick={onClick}
    >
      {STATUS_LABELS[status]}
    </Button>
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
