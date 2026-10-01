/**
 * Inspection tickets (owner, Sep 30; rules in src/lib/inspection.ts). On a ticket of type
 * Inspection — the tech's close-out and the office ticket page — the checklist (each item OK /
 * Issue / N/A with a note) and general notes, saved with "Save inspection". Once the ticket is
 * Done the office may turn it into a repair ticket (linked back to the inspection) or a bid (the
 * estimator opens with the customer, site and findings prefilled) — or do nothing. Nothing is
 * created automatically.
 *
 * `FromInspectionNote` is the "From inspection #6012" link on a ticket created from one.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Calculator, ClipboardCheck, Loader2, Save, Wrench } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import type { ServiceJobRow } from "@/lib/service.functions";
import {
  createRepairFromInspection,
  getSourceInspection,
  getTicketInspection,
  saveTicketInspection,
  type TicketInspection,
} from "@/lib/service-inspection.functions";
import {
  INSPECTION_STATUSES,
  ITEM_NOTE_MAX,
  NOTES_MAX,
  STATUS_LABELS,
  bidPrefillFromInspection,
  fromInspectionLabel,
  inspectionComplete,
  inspectionSummary,
  mergeChecklist,
  parseInspection,
  type InspectionItem,
  type InspectionStatus,
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
import { Textarea } from "@/components/ui/textarea";
import { Box } from "@/components/service/field-shared";
import { errText, fieldKeys, loudError, whenShort } from "@/components/service/field-utils";

const inspectionKey = (jobId: string) => ["service-inspection", jobId] as const;

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
      summary={saved ? inspectionSummary(saved.items) : "not started"}
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
  const { session } = useAuth();
  const getFn = useServerFn(getTicketInspection);
  const q = useQuery({
    queryKey: inspectionKey(job.id),
    queryFn: () => getFn({ data: { id: job.id } }),
    enabled: !!session,
  });
  if (q.error)
    return (
      <p className="text-sm text-destructive">Could not load the inspection: {errText(q.error)}</p>
    );
  if (!q.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the checklist…
      </p>
    );
  return (
    <InspectionEditor
      key={q.data.inspection?.saved_at ?? "new"}
      job={job}
      data={q.data}
      canEdit={canEdit}
      officeOrAdmin={officeOrAdmin}
    />
  );
}

function InspectionEditor({
  job,
  data,
  canEdit,
  officeOrAdmin,
}: {
  job: ServiceJobRow;
  data: TicketInspection;
  canEdit: boolean;
  officeOrAdmin: boolean;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTicketInspection);
  const [items, setItems] = useState<InspectionItem[]>(() =>
    mergeChecklist(data.inspection, data.checklist),
  );
  const [notes, setNotes] = useState(data.inspection?.notes ?? "");
  const [dirty, setDirty] = useState(false);
  const setItem = (id: string, patch: Partial<InspectionItem>) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: job.id,
          inspection: {
            items: items.map((i) => ({ ...i, note: i.note.trim() })),
            notes: notes.trim(),
          },
        },
      }),
    onSuccess: (ins) => {
      setDirty(false);
      toast.success("Inspection saved");
      qc.setQueryData<TicketInspection>(inspectionKey(job.id), (old) =>
        old ? { ...old, inspection: ins } : old,
      );
      // The ticket row carries it too (the section header, the office's actions).
      qc.setQueryData<ServiceJobRow>(fieldKeys.job(job.id), (old) =>
        old ? { ...old, inspection: ins as unknown as ServiceJobRow["inspection"] } : old,
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
    },
    onError: (e) => loudError("Could not save the inspection", e),
  });

  const ro = !canEdit;
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The checklist is empty. An admin adds its items on Admin › Service Rates.
        </p>
      ) : (
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
                      disabled={ro}
                      onClick={() => setItem(item.id, { status: item.status === s ? null : s })}
                    />
                  ))}
                </div>
              </div>
              {(item.status === "issue" || item.note || !ro) && (
                <Input
                  aria-label={`${item.label}: note`}
                  className="h-10 text-base"
                  placeholder={item.status === "issue" ? "What and where" : "Note"}
                  maxLength={ITEM_NOTE_MAX}
                  value={item.note}
                  disabled={ro}
                  onChange={(e) => setItem(item.id, { note: e.target.value })}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-1">
        <Label htmlFor={`inspection-notes-${job.id}`}>Inspection notes</Label>
        <Textarea
          id={`inspection-notes-${job.id}`}
          rows={4}
          className="text-base"
          maxLength={NOTES_MAX}
          value={notes}
          disabled={ro}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button
            type="button"
            className="h-11"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save inspection
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {inspectionSummary(items)}
          {dirty
            ? " · unsaved"
            : data.inspection?.saved_at
              ? ` · saved ${whenShort(data.inspection.saved_at)}${data.inspection.saved_by ? ` by ${data.inspection.saved_by}` : ""}`
              : ""}
        </span>
      </div>
      {officeOrAdmin && <OfficeActions job={job} data={data} dirty={dirty} />}
    </div>
  );
}

function StatusButton({
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
        : "bg-slate-600 text-white hover:bg-slate-600/90";
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

/** From a completed inspection: a repair ticket, a bid, or nothing (the office's choice). */
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
  const [type, setType] = useState<"leak" | "other">("leak");
  // Every ticket has a date (owner, Oct 1): the repair ticket gets its day here.
  const [date, setDate] = useState("");
  const complete = inspectionComplete(job.stage);
  const create = useMutation({
    mutationFn: () => createFn({ data: { id: job.id, service_type: type, scheduled_date: date } }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: inspectionKey(job.id) });
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
      toast.success(`Repair ticket #${row.number} created`, {
        action: {
          label: "Open",
          onClick: () => void navigate({ to: "/service", search: { id: row.id } }),
        },
      });
    },
    onError: (e) => toast.error(`Could not create the repair ticket: ${errText(e)}`),
  });
  const ins = data.inspection;
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
      <p className="font-medium">After the inspection</p>
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
            <p className="text-amber-700 dark:text-amber-400">Save the inspection first.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {manager && (
              <>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v === "other" ? "other" : "leak")}
                >
                  <SelectTrigger className="h-10 w-[120px]" aria-label="Repair ticket type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leak">Leak</SelectItem>
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
                  onClick={() => create.mutate()}
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
              (dirty ? (
                <Button type="button" variant="outline" className="h-10" disabled>
                  <Calculator className="mr-2 h-4 w-4" /> Create bid
                </Button>
              ) : (
                <Button asChild variant="outline" className="h-10">
                  <Link
                    to="/estimate"
                    search={bidPrefillFromInspection(
                      {
                        number: job.number,
                        customer_name: job.customer_name,
                        account_id: job.account_id,
                        site_id: job.site_id,
                        site_name: job.site_name,
                        site: data.site,
                      },
                      ins,
                    )}
                  >
                    <Calculator className="mr-2 h-4 w-4" /> Create bid
                  </Link>
                </Button>
              ))}
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
