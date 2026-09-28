/**
 * The field side of a ticket on the office ticket page (docs/service-module-design.md §5.3):
 * the site contact select, and read-only sections for what the technician recorded (repairs
 * with photos, close-out notes and signature, time; time is editable for the office) plus the
 * ticket's timeline with an "Add note" box.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  MessageSquare,
  PenLine,
  Phone,
  PhoneCall,
  Truck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { listContacts } from "@/lib/crm.functions";
import { STAGE_LABELS, type ServiceJobWithTech, type ServiceStage } from "@/lib/service.functions";
import {
  addJobNote,
  listJobEvents,
  listJobPhotos,
  listJobRepairs,
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
import { PhotoThumb, TimeEntries } from "@/components/service/field-shared";
import {
  errText,
  fieldKeys,
  loudError,
  useSignedUrl,
  whenShort,
} from "@/components/service/field-utils";

// ---------------------------------------------------------------------------------------------
// Contact select (under the site card)

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
  return (
    <div className="space-y-1">
      <label htmlFor="ticket-contact" className="text-sm font-medium">
        Site contact
      </label>
      <Select
        value={value || "none"}
        disabled={disabled || q.isLoading}
        onValueChange={(v) => onChange(v === "none" ? "" : v)}
      >
        <SelectTrigger id="ticket-contact">
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
// Read-only field sections

function Box({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Wrench;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={title}>
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4" /> {title}
      </h2>
      {children}
    </section>
  );
}

/** Repairs, close-out, time and timeline of a ticket, below its Materials used. */
export function TicketFieldSections({
  job,
  officeOrAdmin,
}: {
  job: ServiceJobWithTech;
  officeOrAdmin: boolean;
}) {
  return (
    <>
      <RepairsReadOnly jobId={job.id} />
      <CloseoutSummary job={job} />
      <Box title="Time" icon={Clock}>
        <TimeEntries
          jobId={job.id}
          editable={officeOrAdmin}
          defaultHelpers={job.helper_count}
          compact
        />
      </Box>
      <Timeline jobId={job.id} />
    </>
  );
}

function RepairsReadOnly({ jobId }: { jobId: string }) {
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
  return (
    <Box title="Repairs" icon={Wrench}>
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
                  <div className="flex flex-wrap gap-2 pt-1">
                    {mine.map((p) => (
                      <PhotoThumb key={p.id} photo={p} size="sm" />
                    ))}
                  </div>
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
          <div className="flex flex-wrap gap-2">
            {loose.map((p) => (
              <PhotoThumb key={p.id} photo={p} size="sm" />
            ))}
          </div>
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
  return (
    <Box title="Close-out" icon={CheckCircle2}>
      {!any ? (
        <p className="text-sm text-muted-foreground">Not closed out yet.</p>
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
    default:
      return { icon: History, text: [e.kind, e.note].filter(Boolean).join(": ") };
  }
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
    onSuccess: () => {
      setNote("");
      toast.success("Note added");
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
    },
    onError: (e) => loudError("Could not add the note", e),
  });
  const rows = q.data ?? [];
  return (
    <Box title="Timeline" icon={History}>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) add.mutate();
        }}
      >
        <Textarea
          rows={2}
          placeholder="Add a note to this ticket…"
          value={note}
          maxLength={5000}
          onChange={(e) => setNote(e.target.value)}
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
