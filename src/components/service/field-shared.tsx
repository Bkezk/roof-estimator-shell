/**
 * Components shared by the technician's phone flow (closeout) and the office ticket page
 * (docs/service-module-design.md §5.3): photo thumbnails and the time-entry editor.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, X } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  deleteTimeEntry,
  listTimeEntries,
  saveTimeEntry,
  type JobPhotoRow,
  type TimeEntryRow,
} from "@/lib/service-field.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clock,
  errText,
  fieldKeys,
  localYmd,
  loudError,
  shortDay,
  useSignedUrl,
} from "@/components/service/field-utils";

const ROLE_LABEL: Record<string, string> = {
  before: "Before",
  after: "After",
  other: "Photo",
  signature: "Signature",
};

/** A square thumbnail; a tap opens the full photo. Delete asks first. */
export function PhotoThumb({
  photo,
  onDelete,
  deleting,
  size = "md",
}: {
  photo: JobPhotoRow;
  onDelete?: (() => void) | undefined;
  deleting?: boolean | undefined;
  size?: "sm" | "md" | undefined;
}) {
  const url = useSignedUrl(photo.storage_path);
  const box = size === "sm" ? "h-16 w-16" : "h-20 w-20";
  return (
    <div className={`relative ${box} shrink-0 overflow-hidden rounded-md border bg-muted`}>
      {url.data ? (
        <a href={url.data} target="_blank" rel="noreferrer" title="Open the full photo">
          <img
            src={url.data}
            alt={`${ROLE_LABEL[photo.role] ?? "Photo"} photo`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </a>
      ) : url.error ? (
        <span className="flex h-full items-center justify-center p-1 text-center text-[10px] text-destructive">
          Could not load
        </span>
      ) : (
        <span className="flex h-full items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </span>
      )}
      <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] font-medium text-white">
        {ROLE_LABEL[photo.role] ?? photo.role}
      </span>
      {onDelete && (
        <button
          type="button"
          className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
          aria-label="Delete this photo"
          title="Delete this photo"
          disabled={deleting}
          onClick={() => {
            if (window.confirm("Delete this photo?")) onDelete();
          }}
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Time entries: travel and labor to the quarter hour. The buttons write them; this fixes them.

const KIND_LABEL: Record<string, string> = { travel: "Travel", labor: "Labor" };
const quarter = (h: number) => Math.round(h * 4) / 4;
const fmtHours = (h: number) => `${Number(h.toFixed(2))} h`;

interface TimeVals {
  kind: "travel" | "labor";
  hours: number;
  helper_count: number;
  on_date: string;
}
const valsOf = (e: TimeEntryRow): TimeVals => ({
  kind: e.kind === "travel" ? "travel" : "labor",
  hours: Number(e.hours),
  helper_count: e.helper_count,
  on_date: e.on_date,
});
const sameVals = (a: TimeVals, b: TimeVals) =>
  a.kind === b.kind &&
  a.hours === b.hours &&
  a.helper_count === b.helper_count &&
  a.on_date === b.on_date;

/**
 * The ticket's time entries as an editable list (kind, hours, helpers, date) with add and
 * delete. Read-only when `editable` is false: then only the totals and the lines show.
 */
export function TimeEntries({
  jobId,
  editable,
  defaultHelpers,
  compact,
}: {
  jobId: string;
  editable: boolean;
  defaultHelpers: number;
  compact?: boolean | undefined;
}) {
  const { session } = useAuth();
  const listFn = useServerFn(listTimeEntries);
  const q = useQuery({
    queryKey: fieldKeys.time(jobId),
    queryFn: () => listFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const [adding, setAdding] = useState(false);
  const rows = q.data ?? [];
  const total = (k: string) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.hours, 0);
  const manHours = rows.reduce((s, r) => s + r.hours * (1 + r.helper_count), 0);

  if (q.error)
    return <p className="text-sm text-destructive">Could not load time: {errText(q.error)}</p>;
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading time…</p>;
  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Travel</span> {fmtHours(total("travel"))} ·{" "}
          <span className="font-medium">Labor</span> {fmtHours(total("labor"))}
          <span className="text-muted-foreground"> · {fmtHours(manHours)} with helpers</span>
        </p>
      )}
      {rows.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No time recorded yet.</p>
      )}
      {editable ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <TimeRow key={r.id} entry={r} jobId={jobId} />
          ))}
          {adding ? (
            <NewTimeRow
              jobId={jobId}
              defaultHelpers={defaultHelpers}
              onClose={() => setAdding(false)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              className={compact ? "" : "h-11 w-full sm:w-auto"}
              onClick={() => setAdding(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Add time
            </Button>
          )}
        </div>
      ) : (
        rows.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
                <span>
                  {KIND_LABEL[r.kind] ?? r.kind} · {fmtHours(r.hours)}
                  {r.helper_count
                    ? ` · ${r.helper_count} helper${r.helper_count > 1 ? "s" : ""}`
                    : ""}
                </span>
                <span className="text-muted-foreground">
                  {shortDay(r.on_date)}
                  {r.source === "buttons" && r.started_at && r.ended_at
                    ? ` · ${clock(r.started_at)} to ${clock(r.ended_at)}`
                    : r.source === "manual"
                      ? " · by hand"
                      : ""}
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function TimeFields({
  vals,
  onChange,
  onCommit,
  disabled,
}: {
  vals: TimeVals;
  onChange: (v: TimeVals) => void;
  /** Called when a field is left or a pick is made, with the values to keep. */
  onCommit?: ((v: TimeVals) => void) | undefined;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_90px_90px_1fr]">
      <label className="space-y-1 text-xs text-muted-foreground">
        Kind
        <Select
          value={vals.kind}
          disabled={disabled}
          onValueChange={(k) => {
            const v = { ...vals, kind: k as TimeVals["kind"] };
            onChange(v);
            onCommit?.(v);
          }}
        >
          <SelectTrigger className="h-11 bg-background text-base text-foreground sm:h-9 sm:text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="travel">Travel</SelectItem>
            <SelectItem value="labor">Labor</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Hours
        <NumberField
          value={vals.hours}
          step="0.25"
          max={24}
          inputMode="decimal"
          disabled={disabled}
          className="h-11 text-base text-foreground sm:h-9 sm:text-sm"
          onChange={(h) => onChange({ ...vals, hours: h })}
          onBlur={() => {
            const v = { ...vals, hours: quarter(vals.hours) };
            onChange(v);
            onCommit?.(v);
          }}
        />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Helpers
        <NumberField
          value={vals.helper_count}
          max={9}
          inputMode="numeric"
          disabled={disabled}
          className="h-11 text-base text-foreground sm:h-9 sm:text-sm"
          onChange={(n) => onChange({ ...vals, helper_count: Math.round(n) })}
          onBlur={() => onCommit?.(vals)}
        />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Date
        <Input
          type="date"
          value={vals.on_date}
          disabled={disabled}
          className="h-11 text-base text-foreground sm:h-9 sm:text-sm"
          onChange={(e) => {
            if (!e.target.value) return;
            const v = { ...vals, on_date: e.target.value };
            onChange(v);
            onCommit?.(v);
          }}
        />
      </label>
    </div>
  );
}

function TimeRow({ entry, jobId }: { entry: TimeEntryRow; jobId: string }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTimeEntry);
  const deleteFn = useServerFn(deleteTimeEntry);
  const [vals, setVals] = useState<TimeVals>(() => valsOf(entry));
  const save = useMutation({
    mutationFn: (v: TimeVals) => saveFn({ data: { id: entry.id, service_job_id: jobId, ...v } }),
    onSuccess: (row) => {
      qc.setQueryData<TimeEntryRow[]>(fieldKeys.time(jobId), (old) =>
        old?.map((r) => (r.id === row.id ? row : r)),
      );
    },
    onError: (e) => {
      setVals(valsOf(entry));
      loudError("Could not save the time", e);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: entry.id, service_job_id: jobId } }),
    onSuccess: () => {
      qc.setQueryData<TimeEntryRow[]>(fieldKeys.time(jobId), (old) =>
        old?.filter((r) => r.id !== entry.id),
      );
      toast.success("Time line deleted");
    },
    onError: (e) => loudError("Could not delete the time", e),
  });
  const commit = (v: TimeVals) => {
    if (sameVals(v, valsOf(entry))) return;
    if (v.hours <= 0) {
      loudError("Hours must be more than 0", new Error("delete the line instead"));
      setVals(valsOf(entry));
      return;
    }
    save.mutate(v);
  };
  return (
    <div className="space-y-1 rounded-md border p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <TimeFields
            vals={vals}
            onChange={setVals}
            onCommit={commit}
            disabled={remove.isPending}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-5 h-11 w-11 shrink-0 text-destructive hover:text-destructive sm:h-9 sm:w-9"
          aria-label="Delete this time line"
          title="Delete this time line"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm("Delete this time line?")) remove.mutate();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {save.isPending
          ? "Saving…"
          : entry.source === "buttons" && entry.started_at && entry.ended_at
            ? `From the buttons, ${clock(entry.started_at)} to ${clock(entry.ended_at)}`
            : "Entered by hand"}
      </p>
    </div>
  );
}

function NewTimeRow({
  jobId,
  defaultHelpers,
  onClose,
}: {
  jobId: string;
  defaultHelpers: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTimeEntry);
  const [vals, setVals] = useState<TimeVals>(() => ({
    kind: "labor",
    hours: 0,
    helper_count: defaultHelpers,
    on_date: localYmd(),
  }));
  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { service_job_id: jobId, ...vals, hours: quarter(vals.hours) } }),
    onSuccess: (row) => {
      qc.setQueryData<TimeEntryRow[]>(fieldKeys.time(jobId), (old) => [...(old ?? []), row]);
      toast.success("Time added");
      onClose();
    },
    onError: (e) => loudError("Could not add the time", e),
  });
  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-2">
      <TimeFields vals={vals} onChange={setVals} disabled={save.isPending} />
      <div className="flex gap-2">
        <Button
          type="button"
          className="h-11 flex-1 sm:h-9 sm:flex-none"
          disabled={save.isPending}
          onClick={() => {
            if (quarter(vals.hours) <= 0) {
              loudError("Enter the hours", new Error("to the quarter hour, e.g. 1.25"));
              return;
            }
            save.mutate();
          }}
        >
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 sm:h-9"
          disabled={save.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
