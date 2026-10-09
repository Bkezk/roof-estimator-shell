/**
 * Components shared by the technician's phone flow (closeout) and the office ticket page
 * (docs/service-module-design.md §5.3): photo thumbnails, the time-entry editor and the ticket
 * page's section box (optionally collapsible, its open state remembered per section).
 */
import { sectionTone } from "@/components/service/section-tones";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  PenLine,
  Plus,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import type { AutosaveState } from "@/lib/autosave";
import { marksSummary, parsePhotoMarks, photoOrdinals } from "@/lib/photo-annotations";
import { photoDragData, setPhotoDrag } from "@/lib/photo-drag";
import { MarksOverlay, PhotoLightbox } from "@/components/service/photo-markup";

import { useAuth } from "@/lib/auth-store";
import { listJobCrew } from "@/lib/service.functions";
import { billedCrewLine } from "@/lib/service-crew";
import {
  deleteTimeEntry,
  estimateTravel,
  listTimeEntries,
  saveTimeEntry,
  type JobPhotoRow,
  type TimeEntryRow,
} from "@/lib/service-field.functions";
import type { TravelEstimate } from "@/lib/travel-estimate";
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

// ---------------------------------------------------------------------------------------------
// Auto-save status: subtle while all is well (a failure also raises a loud toast).

export function SavedIndicator({ state }: { state: AutosaveState }) {
  if (state === "idle") return null;
  if (state === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" /> Not saved
      </span>
    );
  if (state === "saved")
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <Check className="h-3.5 w-3.5" /> Saved
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Section box: a bordered section with a title. Collapsible sections (owner, Sep 28: the ticket
// page had too much open at once) show a one-line summary in the header and remember, per
// section, whether the user left them open.

const SECTIONS_KEY = "bid-o-matic:ticket-sections";

function readSections(): Record<string, boolean> {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}
function writeSection(key: string, open: boolean) {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readSections(), [key]: open }));
  } catch {
    // Storage blocked (private mode, blocked site data): the toggle still works this visit.
  }
}
function initialOpen(storageKey: string | undefined, fallback: boolean) {
  if (!storageKey) return fallback;
  const v = readSections()[storageKey];
  return typeof v === "boolean" ? v : fallback;
}

export function Box({
  title,
  icon: Icon,
  children,
  collapsible,
  defaultOpen = true,
  summary,
  storageKey,
  tone: toneKey,
  plain,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  /** The header becomes a toggle; the body shows only while open. */
  collapsible?: boolean | undefined;
  /** The first open state, until the user toggles (then the remembered one wins). */
  defaultOpen?: boolean | undefined;
  /** Shown muted on the right of the header, open or closed. */
  summary?: React.ReactNode;
  /** Remembers the open state under this key (localStorage). */
  storageKey?: string | undefined;
  /** Its colour (SECTION_TONES key); else the storage key's. */
  tone?: string | undefined;
  /**
   * Inside a card already (the close-out's step card, owner Oct 9: "a box in a box … awkward and
   * cramped"): no border or background of its own, a rule above instead, and the header flush
   * with the card's padding.
   */
  plain?: boolean | undefined;
}) {
  const [open, setOpen] = useState(() => initialOpen(storageKey, defaultOpen));
  const t = sectionTone(toneKey ?? storageKey);
  const hasSummary = summary !== undefined && summary !== null && summary !== false;

  if (!collapsible)
    return (
      <section
        className={
          plain ? "space-y-3 border-t pt-3" : `space-y-3 rounded-lg border p-4 ${t?.edge ?? ""}`
        }
        aria-label={title}
      >
        {hasSummary ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <Icon className={`h-4 w-4 ${t?.icon ?? ""}`} /> {title}
            </h2>
            <span className="text-sm text-muted-foreground">{summary}</span>
          </div>
        ) : (
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon className={`h-4 w-4 ${t?.icon ?? ""}`} /> {title}
          </h2>
        )}
        {children}
      </section>
    );

  const Chevron = open ? ChevronDown : ChevronRight;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) writeSection(storageKey, next);
  };
  return (
    <section
      className={plain ? "border-t" : `overflow-hidden rounded-lg border ${t?.edge ?? ""}`}
      aria-label={title}
    >
      <h2>
        <button
          type="button"
          className={`flex w-full items-center justify-between gap-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
            plain ? "min-h-11 py-2" : `p-4 ${t?.head ?? ""}`
          }`}
          aria-expanded={open}
          onClick={toggle}
        >
          <span className="flex shrink-0 items-center gap-2 font-semibold">
            <Icon className={`h-4 w-4 ${t?.icon ?? ""}`} /> {title}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-sm font-normal text-muted-foreground">
            {hasSummary && <span className="min-w-0 truncate">{summary}</span>}
            <Chevron className="h-4 w-4 shrink-0" aria-hidden />
          </span>
        </button>
      </h2>
      {open && (
        <div className={plain ? "space-y-3 pb-2" : `space-y-3 px-4 pb-4 ${t ? "pt-3" : ""}`}>
          {children}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Photos

const ROLE_LABEL: Record<string, string> = {
  before: "Before",
  after: "After",
  other: "Photo",
  signature: "Signature",
};

/**
 * A square thumbnail with the photo's marks drawn over it (and a "Marked" badge); a tap opens
 * the lightbox (photo-markup.tsx): the photo with its marks, Mark up when `canAnnotate`, and
 * Download. Delete asks first.
 */
export function PhotoThumb({
  photo,
  onDelete,
  deleting,
  size = "md",
  canAnnotate = false,
  ticketNumber,
  ordinal,
}: {
  photo: JobPhotoRow;
  onDelete?: (() => void) | undefined;
  deleting?: boolean | undefined;
  size?: "sm" | "md" | undefined;
  /** The lightbox offers Mark up (the ticket's editors: the tech's close-out, the office). */
  canAnnotate?: boolean | undefined;
  /** The ticket's number, for the downloaded file's name ("6012-before-1.png"). */
  ticketNumber?: string | number | null | undefined;
  /** The photo's number among the ticket's photos of its role (else read from the list). */
  ordinal?: number | undefined;
}) {
  const url = useSignedUrl(photo.storage_path);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const marks = useMemo(() => parsePhotoMarks(photo.annotations), [photo.annotations]);
  const box = size === "sm" ? "h-16 w-16" : "h-20 w-20";
  const n =
    ordinal ??
    photoOrdinals(
      qc.getQueryData<JobPhotoRow[]>(fieldKeys.photos(photo.service_job_id)) ?? [photo],
    ).get(photo.id) ??
    1;
  return (
    <div
      className={`relative ${box} shrink-0 overflow-hidden rounded-md border bg-muted ${url.data ? "cursor-grab active:cursor-grabbing" : ""}`}
      // Owner, Oct 7: drag a photo out onto the desktop to save it (Chrome / Edge: DownloadURL).
      draggable={!!url.data}
      onDragStart={(e) => {
        if (!url.data) return;
        setPhotoDrag(
          e.dataTransfer,
          photoDragData(url.data, ticketNumber, photo.role, n, photo.storage_path),
          url.data,
        );
      }}
    >
      {url.data ? (
        <button
          type="button"
          className="block h-full w-full"
          title={
            (marks.length ? "Open the photo (marked)" : "Open the photo") +
            " — or drag it to your desktop to save it"
          }
          onClick={() => setOpen(true)}
        >
          <img
            src={url.data}
            alt={`${ROLE_LABEL[photo.role] ?? "Photo"} photo`}
            className="h-full w-full object-cover"
            loading="lazy"
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
          {natural && <MarksOverlay marks={marks} w={natural.w} h={natural.h} fit="cover" />}
        </button>
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
      {marks.length > 0 && (
        <span
          className="pointer-events-none absolute left-0 top-0 inline-flex items-center gap-0.5 rounded-br bg-red-600 px-1 text-[10px] font-medium text-white"
          title={marksSummary(marks)}
        >
          <PenLine className="h-2.5 w-2.5" aria-hidden /> Marked
        </span>
      )}
      {open && url.data && (
        <PhotoLightbox
          photo={photo}
          url={url.data}
          open={open}
          onOpenChange={setOpen}
          canAnnotate={canAnnotate}
          ticketNumber={ticketNumber}
          ordinal={n}
        />
      )}
      {onDelete && (
        <button
          type="button"
          className="absolute right-0.5 top-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
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
// Time entries: travel and labor to the quarter hour, typed here (owner, Oct 8: no En route /
// On site buttons any more; older entries those made still show their clock times).

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
 *
 * `suggestTravel` (the close-out only; owner, Oct 9): while the ticket has no Travel line, the
 * server's office → site estimate (estimateTravel) opens the Add form prefilled — kind Travel,
 * the round-trip hours, today — with the estimate under it and one "Add travel" tap; the tech
 * changes the hours first if they like. No estimate (an address missing, nothing found): the
 * section is exactly as before, the empty "Add time" button.
 */
export function TimeEntries({
  jobId,
  editable,
  defaultHelpers,
  compact,
  suggestTravel,
}: {
  jobId: string;
  editable: boolean;
  defaultHelpers: number;
  compact?: boolean | undefined;
  suggestTravel?: boolean | undefined;
}) {
  const { session } = useAuth();
  const listFn = useServerFn(listTimeEntries);
  const travelFn = useServerFn(estimateTravel);
  // Owner, Oct 9 (S13): fresh for 30 s; a save puts its row in the cache itself.
  const q = useQuery({
    queryKey: fieldKeys.time(jobId),
    queryFn: () => listFn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const hasTravel = (q.data ?? []).some((r) => r.kind === "travel");
  // Read only where it is offered and only while no Travel line exists; the office and the
  // site do not move, so an hour's freshness is plenty.
  const travel = useQuery({
    queryKey: fieldKeys.travelEstimate(jobId),
    queryFn: () => travelFn({ data: { id: jobId } }),
    enabled: !!session && !!suggestTravel && editable && q.isSuccess && !hasTravel,
    staleTime: 60 * 60_000,
  });
  // Cancel on the prefilled form puts the plain "Add time" button back for this visit.
  const [travelDismissed, setTravelDismissed] = useState(false);
  const suggested: TravelEstimate | null =
    suggestTravel && editable && !hasTravel && !travelDismissed ? (travel.data ?? null) : null;
  const crewFn = useServerFn(listJobCrew);
  const crewQ = useQuery({
    queryKey: fieldKeys.crew(jobId),
    queryFn: () => crewFn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const [adding, setAdding] = useState(false);
  const rows = q.data ?? [];
  const total = (k: string) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.hours, 0);
  const billedFor = crewQ.data ? billedCrewLine(crewQ.data, rows) : null;

  // Owner, Oct 9 (B2): a failed background re-read keeps the cached lines and Add time on
  // screen, with a small line saying the refresh failed; only a first read with nothing fails loud.
  if (q.error && !q.data)
    return <p className="text-sm text-destructive">Could not load time: {errText(q.error)}</p>;
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading time…</p>;
  return (
    <div className="space-y-3">
      {q.error && <p className="text-xs text-destructive">Could not refresh: {errText(q.error)}</p>}
      {/* Owner, Oct 9 (B7): who the time is billed for comes BEFORE the first line, so a tech
          does not add a second line for the helper — one line covers everyone on the job. */}
      {billedFor && (
        <p className="text-sm text-muted-foreground">
          {billedFor}
          {editable && crewQ.data && crewQ.data.length > 1
            ? " — one time line covers everyone on the job"
            : ""}
        </p>
      )}
      {rows.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Travel</span> {fmtHours(total("travel"))} ·{" "}
          <span className="font-medium">Labor</span> {fmtHours(total("labor"))}
        </p>
      )}
      {rows.length === 0 && !adding && !suggested && (
        <p className="text-sm text-muted-foreground">No time recorded yet.</p>
      )}
      {editable ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <TimeRow key={r.id} entry={r} jobId={jobId} />
          ))}
          {suggested && !adding ? (
            <NewTimeRow
              key="travel-estimate"
              jobId={jobId}
              defaultHelpers={defaultHelpers}
              initial={{ kind: "travel", hours: suggested.hours }}
              note={suggested.note}
              hint={`${suggested.note} — round trip`}
              submitLabel="Add travel"
              onClose={() => setTravelDismissed(true)}
            />
          ) : adding ? (
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
                </span>
                <span className="text-muted-foreground">
                  {shortDay(r.on_date)}
                  {r.started_at && r.ended_at
                    ? ` · ${clock(r.started_at)} to ${clock(r.ended_at)}`
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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_90px_1fr]">
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
      {/* No Helpers box (owner, Oct 5): the named crew is who is billed (billedCrewLine). */}
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
      {(save.isPending || (entry.started_at && entry.ended_at)) && (
        <p className="text-[11px] text-muted-foreground">
          {save.isPending ? "Saving…" : `${clock(entry.started_at)} to ${clock(entry.ended_at)}`}
        </p>
      )}
    </div>
  );
}

function NewTimeRow({
  jobId,
  defaultHelpers,
  initial,
  note,
  hint,
  submitLabel = "Add",
  onClose,
}: {
  jobId: string;
  defaultHelpers: number;
  /** Prefilled values (the travel estimate: kind Travel and its hours); else blank labor today. */
  initial?: Partial<Pick<TimeVals, "kind" | "hours">> | undefined;
  /** Saved in the entry's note column (service_time_entries.note) — the estimate's line. */
  note?: string | undefined;
  /** A muted line under the boxes saying where the prefill came from. */
  hint?: string | undefined;
  submitLabel?: string | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTimeEntry);
  const [vals, setVals] = useState<TimeVals>(() => ({
    kind: initial?.kind ?? "labor",
    hours: initial?.hours ?? 0,
    helper_count: defaultHelpers,
    on_date: localYmd(),
  }));
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          service_job_id: jobId,
          ...vals,
          hours: quarter(vals.hours),
          ...(note ? { note } : {}),
        },
      }),
    onSuccess: (row) => {
      qc.setQueryData<TimeEntryRow[]>(fieldKeys.time(jobId), (old) => [...(old ?? []), row]);
      toast.success(row.kind === "travel" ? "Travel added" : "Time added");
      onClose();
    },
    onError: (e) => loudError("Could not add the time", e),
  });
  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-2">
      <TimeFields vals={vals} onChange={setVals} disabled={save.isPending} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
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
          {submitLabel}
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
