/**
 * The technician's close-out on one scrolling screen (docs/service-module-design.md §5.3):
 * helpers, repairs from the template chips with before / after photos, materials off the truck,
 * closing notes, time (fix a forgotten button press), the customer's signature, then Complete.
 *
 * Repairs, photos, time and the signature save as they are made. The text fields save with
 * Save / Complete and are also kept in localStorage per ticket (bid-o-matic:closeout:<id>) so a
 * lost signal on the roof does not lose typed notes. Photos are NOT queued offline: an upload
 * without signal fails loudly and the tech takes it again.
 *
 * Reached from Today's Done button and the ticket page's Close out (/service?id=<id>&closeout=1).
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
  Clock,
  ClipboardList,
  Loader2,
  Lock,
  MapPin,
  Minus,
  Package,
  PenLine,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  listServiceJobMaterials,
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
} from "@/lib/service-field.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/service/signature-pad";
import { PhotoThumb, TimeEntries } from "@/components/service/field-shared";
import {
  clock,
  errText,
  fieldKeys,
  getPosition,
  loudError,
  removeFromServiceBucket,
  uploadToServiceBucket,
  useSignedUrl,
  whenShort,
} from "@/components/service/field-utils";

// ---------------------------------------------------------------------------------------------
// The text fields and their local draft.

interface TextDraft {
  helper_count: number;
  closing_notes: string;
  checked_in_with: string;
  checked_out_with: string;
  recommend_new_roof: boolean;
  signed_by: string;
}
const fromJob = (j: ServiceJobRow): TextDraft => ({
  helper_count: j.helper_count,
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
      helper_count:
        typeof d.helper_count === "number" ? Math.min(9, Math.max(0, d.helper_count)) : 0,
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
const FINISHED = ["done", "invoiced", "closed"];

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
  const isTech = !!profile?.technician && profile.role !== "admin";
  const stage = job.stage as ServiceStage;
  const officeStage = isTech && !TECH_STAGES.includes(stage);
  const canEdit = (!isTech || job.technician_id === profile?.id) && !officeStage;

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-10">
            <Link to="/service/today">
              <ArrowLeft className="mr-1 h-4 w-4" /> Today
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
            ? "The office has invoiced or closed this ticket; ask the office if something needs changing."
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
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const saveFn = useServerFn(saveCloseout);
  const statusFn = useServerFn(setFieldStatus);

  const [base, setBase] = useState<TextDraft>(() => fromJob(job));
  const [stored] = useState<TextDraft | null>(() => readDraft(job.id));
  const [draft, setDraft] = useState<TextDraft>(() => stored ?? fromJob(job));
  const dirty = !sameDraft(draft, base);
  const update = (patch: Partial<TextDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      writeDraft(job.id, next);
      return next;
    });
  const told = useRef(false);
  useEffect(() => {
    if (told.current || !stored) return;
    told.current = true;
    if (!sameDraft(stored, fromJob(job)))
      toast.info("Restored the notes you typed here before; press Save to keep them.");
  }, [stored, job]);

  const input = () => ({
    id: job.id,
    helper_count: Math.min(9, Math.max(0, Math.round(draft.helper_count))),
    closing_notes: orNull(draft.closing_notes),
    checked_in_with: orNull(draft.checked_in_with),
    checked_out_with: orNull(draft.checked_out_with),
    recommend_new_roof: draft.recommend_new_roof,
    signed_by: orNull(draft.signed_by),
  });
  const keepRow = (row: ServiceJobRow) =>
    qc.setQueryData<ServiceJobWithTech>(fieldKeys.job(job.id), (old) =>
      old ? { ...old, ...row } : old,
    );

  const save = useMutation({
    mutationFn: () => saveFn({ data: input() }),
    onSuccess: (row) => {
      keepRow(row);
      clearDraft(job.id);
      setBase(draft);
      toast.success("Close-out saved");
    },
    onError: (e) =>
      loudError("Could not save the close-out (your typing is kept on this phone)", e),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const row = await saveFn({ data: input() });
      if (FINISHED.includes(row.stage)) return row;
      return statusFn({ data: { id: job.id, to: "done" } });
    },
    onSuccess: (row) => {
      keepRow(row);
      clearDraft(job.id);
      setBase(draft);
      for (const k of [
        fieldKeys.today,
        fieldKeys.job(job.id),
        fieldKeys.events(job.id),
        fieldKeys.time(job.id),
        ["service-jobs"],
      ])
        void qc.invalidateQueries({ queryKey: k });
      toast.success("Done — the office invoices and closes it");
      void navigate({ to: "/service/today" });
    },
    onError: (e) =>
      loudError("Could not complete the ticket (your typing is kept on this phone)", e),
  });

  const busy = save.isPending || complete.isPending;
  const finished = FINISHED.includes(job.stage);

  return (
    <div className="space-y-5">
      {/* (a) Helpers */}
      <Section title="Helpers" icon={Users}>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12"
            aria-label="One helper fewer"
            disabled={draft.helper_count <= 0}
            onClick={() => update({ helper_count: Math.max(0, draft.helper_count - 1) })}
          >
            <Minus className="h-5 w-5" />
          </Button>
          <div className="w-20">
            <NumberField
              value={draft.helper_count}
              max={9}
              inputMode="numeric"
              className="h-12 text-center text-lg"
              onChange={(v) => update({ helper_count: Math.min(9, Math.max(0, Math.round(v))) })}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12"
            aria-label="One helper more"
            disabled={draft.helper_count >= 9}
            onClick={() => update({ helper_count: Math.min(9, draft.helper_count + 1) })}
          >
            <Plus className="h-5 w-5" />
          </Button>
          <span className="text-sm text-muted-foreground">besides you</span>
        </div>
      </Section>

      {/* (b) Repairs */}
      <RepairsSection jobId={job.id} />

      {/* (c) Materials */}
      <MaterialsSection jobId={job.id} canLog={can("inventory")} />

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
            Labor from On site ({clock(job.on_site_at)}) until now is added when you press Complete.
          </p>
        )}
        <TimeEntries jobId={job.id} editable defaultHelpers={draft.helper_count} />
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

      {/* (g) Save / Complete */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {dirty && (
          <p className="mb-2 text-xs text-muted-foreground">
            Unsaved notes (kept on this phone until saved)
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-14 flex-1 text-base"
            disabled={busy}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Save className="mr-2 h-5 w-5" />
            )}
            Save
          </Button>
          <Button
            type="button"
            className="h-14 flex-[2] text-lg font-semibold"
            disabled={busy}
            onClick={() => complete.mutate()}
          >
            {complete.isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-5 w-5" />
            )}
            {finished ? "Save and finish" : "Complete"}
          </Button>
        </div>
      </div>
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

function RepairsSection({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const repairsFn = useServerFn(listJobRepairs);
  const photosFn = useServerFn(listJobPhotos);
  const recentFn = useServerFn(recentRepairsForJob);
  const templatesFn = useServerFn(listRepairTemplates);
  const saveFn = useServerFn(saveJobRepair);

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
  const recent = useQuery({
    queryKey: ["repair-templates-recent", jobId],
    queryFn: () => recentFn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  const favs = useQuery({
    queryKey: ["repair-templates", "top"],
    queryFn: () => templatesFn({ data: { limit: 24 } }),
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
    queryKey: ["repair-templates", "q", q],
    queryFn: () => templatesFn({ data: { q, limit: 30 } }),
    enabled: !!session && q.length >= 2,
    staleTime: 60_000,
  });
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherName, setOtherName] = useState("");

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
              }
            : { service_job_id: jobId, name: t.name, unit: "EA", quantity: 1 },
      }),
    onSuccess: (row) => {
      qc.setQueryData<JobRepairRow[]>(fieldKeys.repairs(jobId), (old) => [...(old ?? []), row]);
      toast.success(`Added ${row.name}`);
      setOtherName("");
      setOtherOpen(false);
    },
    onError: (e) => loudError("Could not add the repair", e),
  });

  const recentRows = recent.data ?? [];
  const recentIds = new Set(recentRows.map((t) => t.id));
  const favRows = (favs.data ?? []).filter((t) => !recentIds.has(t.id));
  const rows = repairs.data ?? [];
  const allPhotos = photos.data ?? [];

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
      {repairs.error && (
        <p className="text-sm text-destructive">
          Could not load the repairs: {errText(repairs.error)}
        </p>
      )}
      {photos.error && (
        <p className="text-sm text-destructive">
          Could not load the photos: {errText(photos.error)}
        </p>
      )}
      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r) => (
            <RepairCard
              key={r.id}
              jobId={jobId}
              repair={r}
              photos={allPhotos.filter((p) => p.repair_id === r.id)}
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {recentRows.length > 0 && (
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
            {favRows.map((t) => (
              <Chip key={t.id} disabled={add.isPending} onClick={() => add.mutate(t)}>
                {t.name}
              </Chip>
            ))}
            <Chip tone="secondary" onClick={() => setOtherOpen((v) => !v)}>
              Other
            </Chip>
          </div>
        </div>
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
        {q.length >= 2 && (
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
          </div>
        )}
      </div>
    </Section>
  );
}

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

function RepairCard({
  jobId,
  repair,
  photos,
}: {
  jobId: string;
  repair: JobRepairRow;
  photos: JobPhotoRow[];
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveJobRepair);
  const deleteFn = useServerFn(deleteJobRepair);
  const registerFn = useServerFn(registerJobPhoto);
  const deletePhotoFn = useServerFn(deleteJobPhoto);
  const [vals, setVals] = useState<RepairVals>(() => repairVals(repair));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const beforeRef = useRef<HTMLInputElement | null>(null);
  const afterRef = useRef<HTMLInputElement | null>(null);

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

  const upload = useMutation({
    mutationFn: async ({ file, role }: { file: File; role: "before" | "after" }) => {
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
            repair_id: repair.id,
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
    onSuccess: (row) => {
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) => [...(old ?? []), row]);
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
      toast.success(`${row.role === "before" ? "Before" : "After"} photo saved`);
    },
    onError: (e, v) =>
      loudError(
        `The ${v.role} photo did not upload (photos are not kept offline; take it again with signal)`,
        e,
      ),
  });
  const delPhoto = useMutation({
    mutationFn: (id: string) => deletePhotoFn({ data: { id, service_job_id: jobId } }),
    onSuccess: (_r, id) =>
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
        old?.filter((p) => p.id !== id),
      ),
    onError: (e) => loudError("Could not delete the photo", e),
  });

  const pick = (role: "before" | "after") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) upload.mutate({ file, role });
  };
  const uploadingRole = upload.isPending ? upload.variables?.role : null;
  const free = !repair.repair_template_id;

  return (
    <article className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
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
      </div>

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
            />
          ))}
        </div>
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
      <div className="grid grid-cols-2 gap-2">
        {(["before", "after"] as const).map((role) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            className="h-12 text-base"
            disabled={uploadingRole === role}
            onClick={() => (role === "before" ? beforeRef : afterRef).current?.click()}
          >
            {uploadingRole === role ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Camera className="mr-2 h-5 w-5" />
            )}
            {role === "before" ? "Before" : "After"}
            {(() => {
              const n = photos.filter((p) => p.role === role).length;
              return n ? ` (${n})` : "";
            })()}
          </Button>
        ))}
      </div>

      <div className="flex justify-end">
        {confirmRemove ? (
          <div className="flex items-center gap-2">
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
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 text-destructive hover:text-destructive"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Remove repair
          </Button>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// (c) Materials

function MaterialsSection({ jobId, canLog }: { jobId: string; canLog: boolean }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listServiceJobMaterials);
  const rows = useQuery({
    queryKey: fieldKeys.materials(jobId),
    queryFn: () => listFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const list = rows.data ?? [];
  return (
    <Section title="Materials" icon={Package}>
      {canLog ? (
        <Button
          type="button"
          variant="outline"
          className="h-12 w-full text-base"
          // Inventory reads ?job=<id> and opens "Take from inventory" for this ticket.
          onClick={() => void navigate({ href: `/inventory?job=${jobId}` })}
        >
          <Package className="mr-2 h-5 w-5" /> Log material off my truck
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Logging material needs Inventory access; ask the office.
        </p>
      )}
      {rows.error ? (
        <p className="text-sm text-destructive">Could not load materials: {errText(rows.error)}</p>
      ) : rows.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="font-medium text-amber-700 dark:text-amber-400">Anything off the truck?</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {list.map((m) => {
            // consumed is stored negative (it leaves stock); a return positive.
            const used = -m.qty;
            return (
              <li key={m.id} className="flex justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  {m.row_label}
                  {m.price_col && m.price_col !== "price" ? ` (${m.price_col})` : ""}
                </span>
                <span className="shrink-0 tabular-nums">
                  {used < 0 ? `returned ${-used}` : used} {m.unit}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
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
