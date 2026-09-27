/**
 * Service phase A (docs/service-module-design.md §5.1, §6): repair tickets. Without an id the
 * page lists tickets grouped by stage (Open → Closed), filterable, with a Recently deleted bin,
 * like the Bids / Takeoffs pages; `?new=1` opens a blank ticket and `?id=<uuid>` an existing
 * one, both on one screen in the order of §5.1. CenterPoint still dispatches and invoices; the
 * ticket carries its CenterPoint ticket / invoice numbers until invoicing moves here.
 *
 * A technician (profiles.technician, not admin) receives only their own tickets (RLS), edits
 * them, sets the stage Open / Scheduled / Done only (TECH_STAGES; the office invoices and
 * closes) and never deletes; the server and RLS enforce the same, this only hides what would be
 * refused.
 *
 * The field side (§5.3): `?id=<uuid>&closeout=1` opens the ticket's close-out
 * (components/service/closeout.tsx); the ticket shows its site contact, the repairs, time,
 * signature and timeline the technician recorded (components/service/ticket-field-sections.tsx).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Loader2,
  Lock,
  MapPin,
  Minus,
  Package,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Wrench,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  deleteServiceJob,
  getServiceJob,
  listDeletedServiceJobs,
  listServiceJobMaterials,
  listServiceJobs,
  restoreServiceJob,
  saveServiceJob,
  SERVICE_STAGES,
  SERVICE_TYPES,
  setServiceStage,
  STAGE_LABELS,
  TECH_STAGES,
  TYPE_LABELS,
  type ServiceJobInput,
  type ServiceJobWithTech,
  type ServiceStage,
  type ServiceType,
} from "@/lib/service.functions";
import { getAccount, siteAddressLine, type AccountHit } from "@/lib/crm.functions";
import { listTechnicians } from "@/lib/auth.functions";
import { AccountPicker, type AccountPickerValue } from "@/components/crm/account-picker";
import { CloseoutScreen } from "@/components/service/closeout";
import { ContactSelect, TicketFieldSections } from "@/components/service/ticket-field-sections";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
/** A date-only column (YYYY-MM-DD) read as a local calendar day, not UTC midnight. */
const day = (ymd: string | null) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
const asStage = (s: string): ServiceStage =>
  (SERVICE_STAGES as readonly string[]).includes(s) ? (s as ServiceStage) : "open";
const asType = (s: string): ServiceType =>
  (SERVICE_TYPES as readonly string[]).includes(s) ? (s as ServiceType) : "other";
const typeLabel = (s: string) => TYPE_LABELS[asType(s)];
/** Inventory location ids ("shop", "veh-n2x384") read as names without importing Inventory. */
const locationLabel = (id: string) =>
  id === "shop" ? "Shop" : id.startsWith("veh-") ? `Vehicle ${id.slice(4).toUpperCase()}` : id;

const STAGE_BADGE: Record<ServiceStage, "default" | "secondary" | "outline"> = {
  open: "default",
  scheduled: "secondary",
  done: "secondary",
  invoiced: "outline",
  closed: "outline",
};

export function ServicePage({
  id,
  isNew,
  closeout,
}: {
  id?: string | undefined;
  isNew?: boolean;
  closeout?: boolean | undefined;
}) {
  if (id) return <TicketLoader id={id} closeout={!!closeout} />;
  if (isNew) return <TicketEditor job={null} />;
  return <ServiceList />;
}

/** A small round toggle button for the filter row. */
function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={props.active ? "default" : "outline"}
      className="h-7 rounded-full px-3 text-xs"
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/** Stage groups the user has collapsed, remembered across reloads (per browser). */
const COLLAPSED_KEY = "bid-o-matic:service-collapsed";
const readCollapsed = (): ServiceStage[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(raw) ? SERVICE_STAGES.filter((s) => raw.includes(s)) : [];
  } catch {
    return [];
  }
};
const writeCollapsed = (stages: ServiceStage[]) => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(stages));
  } catch {
    // Storage unavailable (private mode, blocked site data) — collapse still works this visit.
  }
};

type StageFilter = "all" | ServiceStage;
type TypeFilter = "all" | ServiceType;

function ServiceList() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listServiceJobs);
  const listDeletedFn = useServerFn(listDeletedServiceJobs);
  const deleteFn = useServerFn(deleteServiceJob);
  const restoreFn = useServerFn(restoreServiceJob);
  const list = useQuery({
    queryKey: ["service-jobs"],
    queryFn: () => listFn(),
    enabled: !!session,
  });
  const deletedQuery = useQuery({
    queryKey: ["service-jobs-deleted"],
    queryFn: () => listDeletedFn(),
    enabled: !!session,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["service-jobs"] });
    void qc.invalidateQueries({ queryKey: ["service-jobs-deleted"] });
  };

  // A technician (not admin) receives only their own tickets from the server.
  const isTech = !!profile?.technician && profile.role !== "admin";
  const officeOrAdmin = !isTech;
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // "Mine" defaults on for a technician admin; null = not touched yet (follow the profile). A
  // plain technician has no Mine filter: the list is already only theirs.
  const [mineOverride, setMineOverride] = useState<boolean | null>(null);
  const mine = !isTech && (mineOverride ?? !!profile?.technician);
  const [showDeleted, setShowDeleted] = useState(false);
  const [toDelete, setToDelete] = useState<ServiceJobWithTech | null>(null);
  const [collapsed, setCollapsed] = useState<ServiceStage[]>(readCollapsed);
  const toggleGroup = (stage: ServiceStage) =>
    setCollapsed((prev) => {
      const next = prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage];
      writeCollapsed(next);
      return next;
    });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Ticket moved to Recently deleted");
      setToDelete(null);
      refresh();
    },
    onError: (e) => toast.error(`Could not delete the ticket: ${errText(e)}`),
  });
  const restore = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Ticket restored");
      refresh();
    },
    onError: (e) => toast.error(`Could not restore the ticket: ${errText(e)}`),
  });

  const jobs = list.data ?? [];
  const deleted = deletedQuery.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = jobs.filter((j) => {
    if (mine && j.technician_id !== profile?.id) return false;
    if (stageFilter !== "all" && asStage(j.stage) !== stageFilter) return false;
    if (typeFilter !== "all" && asType(j.service_type) !== typeFilter) return false;
    if (q) {
      const hay = [
        `#${j.number}`,
        String(j.number),
        j.customer_name,
        j.site_name,
        j.site_address,
        j.description,
        j.po_number,
        j.centerpoint_ticket,
        j.centerpoint_invoice,
        j.technician_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Grouped Open → Closed; newest update first inside each group, except Scheduled, which
  // reads soonest first. Empty groups are left out.
  const groups = SERVICE_STAGES.map((stage) => {
    const rows = filtered.filter((j) => asStage(j.stage) === stage);
    if (stage === "scheduled")
      rows.sort((a, b) => (a.scheduled_date ?? "9999").localeCompare(b.scheduled_date ?? "9999"));
    return { stage, rows };
  }).filter((g) => g.rows.length > 0);
  // A technician's stage chips: the stages they set, plus Invoiced / Closed only when the office
  // has put one of their tickets there.
  const stageChips = isTech
    ? SERVICE_STAGES.filter(
        (s) => TECH_STAGES.includes(s) || jobs.some((j) => asStage(j.stage) === s),
      )
    : SERVICE_STAGES;
  const anyFilter = q !== "" || stageFilter !== "all" || typeFilter !== "all" || mine;
  const clearFilters = () => {
    setSearch("");
    setStageFilter("all");
    setTypeFilter("all");
    setMineOverride(false);
  };
  const newTicket = () => void navigate({ to: "/service", search: { new: 1 } });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Wrench className="h-6 w-6" /> Service tickets
          </h1>
          <p className="text-sm text-muted-foreground">
            Repair calls: who, where, which technician and when. CenterPoint still invoices; keep
            its ticket number on the ticket.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="lg" variant="outline" className="text-base">
            <Link to="/service/today">
              <CalendarDays className="mr-2 h-5 w-5" /> My day
            </Link>
          </Button>
          <Button size="lg" className="text-base font-semibold" onClick={newTicket}>
            <Plus className="mr-2 h-5 w-5" /> New ticket
          </Button>
        </div>
      </div>

      {list.error ? (
        <p className="text-sm text-destructive">
          Could not load tickets ({errText(list.error)}). Try refreshing, or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets…
        </p>
      ) : (
        <>
          {jobs.length > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  Search
                  <Input
                    type="search"
                    placeholder="Ticket #, customer, site, description, CenterPoint #…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="bg-background"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Type
                  <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                    <SelectTrigger className="w-[140px] bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {SERVICE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={stageFilter === "all"} onClick={() => setStageFilter("all")}>
                  All stages
                </Chip>
                {stageChips.map((s) => (
                  <Chip
                    key={s}
                    active={stageFilter === s}
                    onClick={() => setStageFilter(stageFilter === s ? "all" : s)}
                  >
                    {STAGE_LABELS[s]}
                  </Chip>
                ))}
                {!isTech && (
                  <>
                    <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                    <Chip active={mine} onClick={() => setMineOverride(!mine)}>
                      Mine
                    </Chip>
                  </>
                )}
                {anyFilter && (
                  <Button variant="ghost" size="sm" className="h-7" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {filtered.length} of {jobs.length} ticket{jobs.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          )}

          {jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">
                {isTech ? "No tickets assigned to you yet." : "No tickets yet."}
              </p>
              <Button variant="outline" className="mt-4" onClick={newTicket}>
                Open the first ticket
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">
                No tickets match these filters{mine ? " (showing only yours)" : ""}.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-8">
              {groups.map(({ stage, rows }) => {
                const open = !collapsed.includes(stage);
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                  <section key={stage} aria-label={`${STAGE_LABELS[stage]} tickets`}>
                    <h2 className={`border-b border-border pb-1.5 ${open ? "mb-3" : ""}`}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={open}
                        aria-controls={`service-group-${stage}`}
                        title={open ? "Collapse this group" : "Expand this group"}
                        onClick={() => toggleGroup(stage)}
                      >
                        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-semibold uppercase tracking-wide">
                          {STAGE_LABELS[stage]}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {rows.length} ticket{rows.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    </h2>
                    {open && (
                      <div id={`service-group-${stage}`} className="grid gap-3">
                        {rows.map((j) => (
                          <TicketListRow
                            key={j.id}
                            row={j}
                            onDelete={officeOrAdmin ? () => setToDelete(j) : undefined}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Recently deleted (soft-deleted tickets) */}
      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted"
          onClick={() => setShowDeleted((v) => !v)}
          aria-expanded={showDeleted}
        >
          <span>Recently deleted{deleted.length ? ` (${deleted.length})` : ""}</span>
          <span className="text-xs text-muted-foreground">{showDeleted ? "Hide" : "Show"}</span>
        </button>
        {showDeleted && (
          <div className="space-y-2 border-t p-4">
            {deletedQuery.error ? (
              <p className="text-sm text-destructive">
                Could not load Recently deleted: {errText(deletedQuery.error)}
              </p>
            ) : deletedQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : deleted.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in Recently deleted.</p>
            ) : (
              deleted.map((j) => (
                <div
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      #{j.number} {j.customer_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Deleted {j.deleted_at ? new Date(j.deleted_at).toLocaleDateString() : "—"}
                      {j.updated_by_name ? ` by ${j.updated_by_name}` : ""}
                      {j.description ? ` · ${j.description}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(j.id)}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    Restore
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete ticket #{toDelete?.number} ({toDelete?.customer_name})?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The ticket moves to Recently deleted at the bottom of this page, where it can be
              restored. Material already logged against it stays in the Inventory ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TicketListRow({
  row: j,
  onDelete,
}: {
  row: ServiceJobWithTech;
  onDelete?: (() => void) | undefined;
}) {
  const stage = asStage(j.stage);
  const meta = [
    j.technician_name ?? "Unassigned",
    j.scheduled_date ? day(j.scheduled_date) : "No date",
    j.centerpoint_ticket ? `CenterPoint #${j.centerpoint_ticket}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 transition-colors duration-150 hover:border-primary/40 hover:bg-muted/40">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/service"
            search={{ id: j.id }}
            className="font-medium underline-offset-2 hover:underline"
            title="Open this ticket"
          >
            #{j.number} {j.customer_name}
          </Link>
          <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium">
            {typeLabel(j.service_type)}
          </Badge>
          <Badge variant={STAGE_BADGE[stage]} className="px-1.5 py-0 text-[11px]">
            {STAGE_LABELS[stage]}
          </Badge>
        </div>
        {(j.site_name || j.description) && (
          <p className="text-sm">
            {j.site_name && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {j.site_name}
                {j.description ? " · " : ""}
              </span>
            )}
            {j.description}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {meta.join(" · ")} · Updated {when(j.updated_at)}
          {j.updated_by_name ? ` by ${j.updated_by_name}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button asChild size="sm" variant="outline">
          <Link to="/service" search={{ id: j.id }}>
            Open
          </Link>
        </Button>
        {onDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            title="Delete this ticket"
            aria-label={`Delete ticket ${j.number}`}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function TicketLoader({ id, closeout }: { id: string; closeout: boolean }) {
  const { session } = useAuth();
  const getFn = useServerFn(getServiceJob);
  const job = useQuery({
    queryKey: ["service-job", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !!session,
  });
  if (job.error)
    return (
      <div className="space-y-3">
        <BackToList />
        <p className="text-sm text-destructive">Could not open the ticket: {errText(job.error)}</p>
      </div>
    );
  if (!job.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the ticket…
      </p>
    );
  if (closeout) return <CloseoutScreen key={job.data.id} job={job.data} />;
  return <TicketEditor key={job.data.id} job={job.data} />;
}

function BackToList() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/service">
        <ArrowLeft className="mr-1 h-4 w-4" /> Tickets
      </Link>
    </Button>
  );
}

interface Draft {
  customer: AccountPickerValue | null;
  /** The picked hit, shown in the card until the account itself has loaded. */
  hit: AccountHit | null;
  /** The site contact (crm_contacts); "" = none. */
  contact_id: string;
  description: string;
  service_type: ServiceType;
  po_number: string;
  /** "" = unassigned. */
  technician_id: string;
  helper_count: number;
  scheduled_date: string;
  centerpoint_ticket: string;
  centerpoint_invoice: string;
  notes: string;
}

const draftFrom = (job: ServiceJobWithTech | null, meId: string | null): Draft =>
  job
    ? {
        customer: job.account_id
          ? {
              account_id: job.account_id,
              site_id: job.site_id,
              label: job.site_name ? `${job.site_name} — ${job.customer_name}` : job.customer_name,
            }
          : null,
        hit: null,
        contact_id: job.contact_id ?? "",
        description: job.description,
        service_type: asType(job.service_type),
        po_number: job.po_number ?? "",
        technician_id: job.technician_id ?? "",
        helper_count: job.helper_count,
        scheduled_date: job.scheduled_date ?? "",
        centerpoint_ticket: job.centerpoint_ticket ?? "",
        centerpoint_invoice: job.centerpoint_invoice ?? "",
        notes: job.notes ?? "",
      }
    : {
        customer: null,
        hit: null,
        contact_id: "",
        description: "",
        service_type: "leak",
        po_number: "",
        technician_id: meId ?? "",
        helper_count: 0,
        scheduled_date: "",
        centerpoint_ticket: "",
        centerpoint_invoice: "",
        notes: "",
      };
/** The fields that decide "unsaved changes" (the card's hit is display only). */
const draftKey = (d: Draft) =>
  JSON.stringify({
    ...d,
    hit: null,
    customer: d.customer && [d.customer.account_id, d.customer.site_id],
  });

function TicketEditor({ job }: { job: ServiceJobWithTech | null }) {
  const { session, profile, can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveServiceJob);
  const stageFn = useServerFn(setServiceStage);
  const deleteFn = useServerFn(deleteServiceJob);
  const techFn = useServerFn(listTechnicians);

  const isTech = !!profile?.technician && profile.role !== "admin";
  const officeOrAdmin = !isTech;
  const jobStage = job ? asStage(job.stage) : null;
  // Invoiced / Closed are the office's; a technician's ticket there is read-only for them (the
  // server refuses a technician's save of those stages).
  const officeStage = isTech && !!jobStage && !TECH_STAGES.includes(jobStage);
  const canEdit = !job || officeOrAdmin || (job.technician_id === profile?.id && !officeStage);
  const stageOptions: readonly ServiceStage[] = isTech
    ? SERVICE_STAGES.filter((s) => TECH_STAGES.includes(s) || s === jobStage)
    : SERVICE_STAGES;

  // A new ticket from the Tech Board's "+" arrives with ?tech=<id>&date=YYYY-MM-DD.
  const prefill: { tech?: string; date?: string } = useSearch({ strict: false });
  const [draft, setDraft] = useState<Draft>(() => {
    const d = draftFrom(job, !job && profile?.technician ? profile.id : null);
    if (job) return d;
    return {
      ...d,
      technician_id: prefill.tech ?? d.technician_id,
      scheduled_date: prefill.date ?? d.scheduled_date,
    };
  });
  const [savedKey, setSavedKey] = useState(() => draftKey(draft));
  const dirty = draftKey(draft) !== savedKey;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const techs = useQuery({
    queryKey: ["technicians"],
    queryFn: () => techFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  const techOptions = useMemo(() => {
    const all = [...(techs.data ?? [])].sort(
      (a, b) => Number(b.technician) - Number(a.technician) || a.name.localeCompare(b.name),
    );
    // Keep a ticket's current assignee listed even if they are no longer on the roster.
    if (job?.technician_id && !all.some((t) => t.id === job.technician_id))
      all.unshift({
        id: job.technician_id,
        name: job.technician_name ?? "Former assignee",
        technician: true,
      });
    return all;
  }, [techs.data, job?.technician_id, job?.technician_name]);

  const save = useMutation({
    mutationFn: () => {
      const stage = job ? asStage(job.stage) : undefined;
      const input: ServiceJobInput = {
        ...(job ? { id: job.id } : {}),
        account_id: draft.customer?.account_id ?? null,
        site_id: draft.customer?.site_id ?? null,
        contact_id: draft.customer ? draft.contact_id || null : null,
        // A ticket from before customer profiles keeps its typed name until one is picked.
        ...(!draft.customer && job ? { customer_name: job.customer_name } : {}),
        description: draft.description,
        service_type: draft.service_type,
        po_number: draft.po_number,
        technician_id: draft.technician_id || null,
        helper_count: draft.helper_count,
        scheduled_date: draft.scheduled_date || null,
        // An Open ticket that now has a technician and a day becomes Scheduled; otherwise the
        // stage stays what the header says (a new ticket's stage is the server's call).
        ...(stage
          ? {
              stage:
                stage === "open" && draft.technician_id && draft.scheduled_date
                  ? "scheduled"
                  : stage,
            }
          : {}),
        notes: draft.notes,
        centerpoint_ticket: draft.centerpoint_ticket,
        centerpoint_invoice: draft.centerpoint_invoice,
      };
      return saveFn({ data: input });
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
      if (row.account_id) void qc.invalidateQueries({ queryKey: ["account", row.account_id] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      if (job) {
        qc.setQueryData(["service-job", row.id], row);
        setSavedKey(draftKey(draft));
        toast.success(`Ticket #${row.number} saved`);
      } else {
        toast.success(`Ticket #${row.number} created`);
        qc.setQueryData(["service-job", row.id], row);
        void navigate({ to: "/service", search: { id: row.id }, replace: true });
      }
    },
    onError: (e) => toast.error(`Could not save the ticket: ${errText(e)}`),
  });

  const stageMut = useMutation({
    mutationFn: (stage: ServiceStage) => stageFn({ data: { id: job!.id, stage } }),
    onSuccess: (_r, stage) => {
      toast.success(`Stage: ${STAGE_LABELS[stage]}`);
      void qc.invalidateQueries({ queryKey: ["service-job", job!.id] });
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => toast.error(`Could not change the stage: ${errText(e)}`),
  });

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: job!.id } }),
    onSuccess: () => {
      toast.success(`Ticket #${job!.number} moved to Recently deleted`);
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
      void qc.invalidateQueries({ queryKey: ["service-jobs-deleted"] });
      void navigate({ to: "/service" });
    },
    onError: (e) => toast.error(`Could not delete the ticket: ${errText(e)}`),
  });

  const submit = () => {
    if (!canEdit || save.isPending) return;
    if (!draft.customer && !job?.customer_name) {
      toast.error("Pick or add the customer first");
      return;
    }
    save.mutate();
  };

  const ro = !canEdit;
  // Close-out: the office and the assigned technician (not once the office has invoiced).
  const canCloseOut = !!job && canEdit;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackToList />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-bold tracking-tight">
            <Wrench className="h-6 w-6 shrink-0" />
            {job ? (
              <>
                <span className="shrink-0">#{job.number}</span>
                <TicketNumberHelp />
                <span className="truncate">· {job.customer_name}</span>
              </>
            ) : (
              <span className="truncate">New ticket</span>
            )}
          </h1>
          {job && (
            <div className="flex flex-wrap items-center gap-2">
              {canCloseOut && (
                <Button asChild>
                  <Link to="/service" search={{ id: job.id, closeout: 1 }}>
                    <ClipboardCheck className="mr-1 h-4 w-4" /> Close out
                  </Link>
                </Button>
              )}
              <Select
                value={asStage(job.stage)}
                disabled={ro || stageMut.isPending}
                onValueChange={(v) => stageMut.mutate(v as ServiceStage)}
              >
                <SelectTrigger className="w-[150px]" aria-label="Stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stageOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {officeOrAdmin && (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              )}
            </div>
          )}
        </div>
        {job && (
          <p className="text-xs text-muted-foreground">
            Updated {when(job.updated_at)}
            {job.updated_by_name ? ` by ${job.updated_by_name}` : ""}
          </p>
        )}
        {isTech && jobStage === "done" && (
          <p className="text-sm text-muted-foreground">Done — the office invoices and closes it.</p>
        )}
      </div>

      {ro && (
        <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <Lock className="h-4 w-4 shrink-0" />
          {officeStage && jobStage
            ? `The office has marked this ticket ${STAGE_LABELS[jobStage]}. You can read it; ask the office if something needs changing.`
            : `This ticket is assigned to ${job?.technician_name ?? "someone else"}. You can read it; only the assigned technician, the office or an admin can change it.`}
        </p>
      )}

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* 1. Customer, with the site / contact card beside it */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ticket-customer">Customer</Label>
            <AccountPicker
              id="ticket-customer"
              value={draft.customer}
              autoFocus={!job}
              disabled={ro}
              placeholder="Search a customer or site (e.g. yellow creek)…"
              onChange={(hit) =>
                setDraft((d) => ({
                  ...d,
                  hit,
                  // Another customer's contacts do not apply.
                  contact_id:
                    hit && d.customer && hit.account_id === d.customer.account_id
                      ? d.contact_id
                      : "",
                  customer: hit
                    ? {
                        account_id: hit.account_id,
                        site_id: hit.site_id,
                        label: hit.site_name
                          ? `${hit.site_name} — ${hit.account_name}`
                          : hit.account_name,
                      }
                    : null,
                }))
              }
            />
            {!draft.customer && job?.customer_name && (
              <p className="text-xs text-muted-foreground">
                Not linked to a customer profile: “{job.customer_name}”. Pick or add one to link it.
              </p>
            )}
          </div>
          <div className="space-y-3">
            <CustomerCard
              accountId={draft.customer?.account_id ?? null}
              siteId={draft.customer?.site_id ?? null}
              hit={draft.hit}
              disabled={ro}
              onPickSite={(site, accountName) =>
                setDraft((d) => ({
                  ...d,
                  customer: d.customer
                    ? {
                        account_id: d.customer.account_id,
                        site_id: site.id,
                        label: `${site.name} — ${accountName}`,
                      }
                    : d.customer,
                }))
              }
            />
            {draft.customer && (
              <ContactSelect
                accountId={draft.customer.account_id}
                siteId={draft.customer.site_id}
                value={draft.contact_id}
                disabled={ro}
                onChange={(v) => set("contact_id", v)}
              />
            )}
          </div>
        </div>

        {/* 2. Description and type */}
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <div className="space-y-1">
            <Label htmlFor="ticket-description">Description</Label>
            <Input
              id="ticket-description"
              value={draft.description}
              disabled={ro}
              maxLength={500}
              placeholder="e.g. Leak over the gym, north wall"
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticket-type">Type</Label>
            <Select
              value={draft.service_type}
              disabled={ro}
              onValueChange={(v) => set("service_type", v as ServiceType)}
            >
              <SelectTrigger id="ticket-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 3. PO # with the customer's billing instruction */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ticket-po">PO #</Label>
            <Input
              id="ticket-po"
              value={draft.po_number}
              disabled={ro}
              maxLength={60}
              onChange={(e) => set("po_number", e.target.value)}
            />
            <BillingNote accountId={draft.customer?.account_id ?? null} />
          </div>
        </div>

        {/* 4. Technician, helpers and day */}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-[1fr_auto_200px]">
          <div className="space-y-1">
            <Label htmlFor="ticket-tech">Technician</Label>
            <Select
              value={draft.technician_id || "none"}
              disabled={ro}
              onValueChange={(v) => set("technician_id", v === "none" ? "" : v)}
            >
              <SelectTrigger id="ticket-tech">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {techOptions.some((t) => t.technician) && (
                  <SelectGroup>
                    <SelectLabel>Technicians</SelectLabel>
                    {techOptions
                      .filter((t) => t.technician)
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.id === profile?.id ? " (me)" : ""}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                )}
                {techOptions.some((t) => !t.technician) && (
                  <SelectGroup>
                    <SelectLabel>Office</SelectLabel>
                    {techOptions
                      .filter((t) => !t.technician)
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.id === profile?.id ? " (me)" : ""}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {techs.error && (
              <p className="text-xs text-destructive">
                Could not load technicians: {errText(techs.error)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticket-helpers">Helpers</Label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-9 w-9"
                disabled={ro || draft.helper_count <= 0}
                aria-label="One helper fewer"
                onClick={() => set("helper_count", Math.max(0, draft.helper_count - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <div className="w-14" id="ticket-helpers">
                <NumberField
                  value={draft.helper_count}
                  min={0}
                  max={9}
                  inputMode="numeric"
                  disabled={ro}
                  className="text-center"
                  onChange={(v) => set("helper_count", Math.min(9, Math.max(0, Math.round(v))))}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-9 w-9"
                disabled={ro || draft.helper_count >= 9}
                aria-label="One helper more"
                onClick={() => set("helper_count", Math.min(9, draft.helper_count + 1))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticket-date">Scheduled date</Label>
            <Input
              id="ticket-date"
              type="date"
              value={draft.scheduled_date}
              disabled={ro}
              onChange={(e) => set("scheduled_date", e.target.value)}
            />
          </div>
        </div>

        {/* 5. CenterPoint numbers (until invoicing moves here) */}
        <div className="space-y-1">
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ticket-cp-ticket" className="text-xs">
                CenterPoint ticket #
              </Label>
              <Input
                id="ticket-cp-ticket"
                className="h-8"
                value={draft.centerpoint_ticket}
                disabled={ro}
                maxLength={40}
                onChange={(e) => set("centerpoint_ticket", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ticket-cp-invoice" className="text-xs">
                CenterPoint invoice #
              </Label>
              <Input
                id="ticket-cp-invoice"
                className="h-8"
                value={draft.centerpoint_invoice}
                disabled={ro}
                maxLength={40}
                onChange={(e) => set("centerpoint_invoice", e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">until invoicing moves here</p>
        </div>

        {/* 6. Notes */}
        <div className="space-y-1">
          <Label htmlFor="ticket-notes">Notes</Label>
          <Textarea
            id="ticket-notes"
            rows={4}
            value={draft.notes}
            disabled={ro}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>

        {!ro && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={save.isPending || (!!job && !dirty)}>
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {job ? "Save" : "Create ticket"}
            </Button>
            {job && dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
            {!job && (
              <span className="text-xs text-muted-foreground">
                Saved as Scheduled when a technician and a date are set, otherwise Open.
              </span>
            )}
          </div>
        )}
      </form>

      {job && <MaterialsUsed jobId={job.id} canLog={can("inventory")} />}

      {job && <TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} />}

      {job && (
        <AlertDialog
          open={confirmDelete}
          onOpenChange={(o) => {
            if (!remove.isPending) setConfirmDelete(o);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete ticket #{job.number} ({job.customer_name})?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The ticket moves to Recently deleted on the Service page, where it can be restored.
                Material already logged against it stays in the Inventory ledger.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={remove.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  remove.mutate();
                }}
              >
                {remove.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/** Why ticket numbers start at 6000 (owner, Sep 27). A popover, so a tap works on a phone. */
function TicketNumberHelp() {
  const text = "Bid-O-Matic numbers start at 6000 so they never collide with CenterPoint's";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={text}
          aria-label="Why does the ticket number start at 6000?"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-sm font-normal" align="start">
        {text}
      </PopoverContent>
    </Popover>
  );
}

/** The account (contact, phone) and site (address, instructions) the ticket is for. */
function CustomerCard(props: {
  accountId: string | null;
  siteId: string | null;
  hit: AccountHit | null;
  disabled: boolean;
  onPickSite: (site: { id: string; name: string }, accountName: string) => void;
}) {
  const { session } = useAuth();
  const getFn = useServerFn(getAccount);
  const accountId = props.accountId;
  const detail = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getFn({ data: { id: accountId! } }),
    enabled: !!session && !!accountId,
  });
  if (!accountId)
    return (
      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Pick a site or customer to see the address and contact here.
      </div>
    );
  const a = detail.data?.account;
  const sites = detail.data?.sites ?? [];
  const site = props.siteId ? sites.find((s) => s.id === props.siteId) : undefined;
  const hit = props.hit;
  const name = a?.name ?? hit?.account_name ?? "";
  const contact = a?.contact_name ?? hit?.contact_name ?? null;
  const phone = a?.phone ?? hit?.phone ?? null;
  const siteName = site?.name ?? hit?.site_name ?? null;
  const address = site ? siteAddressLine(site) : (hit?.site_address ?? "");
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/customers"
          search={{ id: accountId }}
          className="font-medium underline-offset-2 hover:underline"
          title="Open this customer"
        >
          {name || "Customer"}
        </Link>
        {detail.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {detail.error && (
        <p className="text-xs text-destructive">
          Could not load the customer: {errText(detail.error)}
        </p>
      )}
      {props.siteId ? (
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>
            {siteName && <span className="font-medium">{siteName}</span>}
            {address ? (
              <span className="text-muted-foreground">
                {siteName ? ", " : ""}
                {address}
              </span>
            ) : (
              <span className="text-muted-foreground"> (no address on file)</span>
            )}
          </span>
        </p>
      ) : sites.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Which site?</p>
          <Select
            value=""
            disabled={props.disabled}
            onValueChange={(v) => {
              const s = sites.find((x) => x.id === v);
              if (s) props.onPickSite(s, name);
            }}
          >
            <SelectTrigger className="h-8 bg-background">
              <SelectValue placeholder="Pick the site…" />
            </SelectTrigger>
            <SelectContent>
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {siteAddressLine(s) ? ` — ${siteAddressLine(s)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : detail.data ? (
        <p className="text-xs text-muted-foreground">No sites on file for this customer.</p>
      ) : null}
      {(contact || phone) && (
        <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
          {contact && <span>{contact}</span>}
          {phone && (
            <a href={`tel:${phone}`} className="inline-flex items-center gap-1 hover:underline">
              <Phone className="h-3.5 w-3.5" />
              {phone}
            </a>
          )}
        </p>
      )}
      {site?.technician_instructions && (
        <p className="whitespace-pre-line rounded border bg-background px-2 py-1 text-xs">
          <span className="font-medium">Technician instructions: </span>
          {site.technician_instructions}
        </p>
      )}
    </div>
  );
}

/** The customer's billing instruction under PO # ("Need a PO on invoice"), so the office asks. */
function BillingNote({ accountId }: { accountId: string | null }) {
  const { session } = useAuth();
  const getFn = useServerFn(getAccount);
  const detail = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getFn({ data: { id: accountId! } }),
    enabled: !!session && !!accountId,
  });
  const note = accountId ? detail.data?.account.billing_instructions : null;
  if (!note) return null;
  return (
    <p className="whitespace-pre-line text-xs text-amber-700 dark:text-amber-400">
      Billing: {note}
    </p>
  );
}

/** Inventory ledger rows logged against this ticket, and the way to log more. */
function MaterialsUsed({ jobId, canLog }: { jobId: string; canLog: boolean }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listServiceJobMaterials);
  const rows = useQuery({
    queryKey: ["service-job-materials", jobId],
    queryFn: () => listFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Materials used">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Package className="h-4 w-4" /> Materials used
        </h2>
        {canLog ? (
          <Button
            variant="outline"
            size="sm"
            // Inventory reads ?job=<id> to preselect this ticket (a plain URL value; the two
            // modules do not import each other).
            onClick={() => void navigate({ href: `/inventory?job=${jobId}` })}
          >
            <Plus className="mr-1 h-4 w-4" /> Log material
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Logging material needs Inventory access.
          </span>
        )}
      </div>
      {rows.error ? (
        <p className="text-sm text-destructive">Could not load materials: {errText(rows.error)}</p>
      ) : rows.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rows.data?.length ? (
        <p className="text-sm text-muted-foreground">Nothing logged against this ticket yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-3 font-medium">Material</th>
                <th className="py-1.5 pr-3 font-medium">From</th>
                <th className="py-1.5 pr-3 font-medium">Who</th>
                <th className="py-1.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((m) => {
                // consumed is stored negative (it leaves stock); a return (released) positive.
                const used = -m.qty;
                return (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {used < 0 ? `returned ${-used}` : used} {m.unit}
                    </td>
                    <td className="py-1.5 pr-3">
                      {m.row_label}
                      {m.price_col && m.price_col !== "price" ? ` (${m.price_col})` : ""}
                      {m.counted_note ? (
                        <span className="block text-xs text-muted-foreground">
                          {m.counted_note}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3">{locationLabel(m.location_id)}</td>
                    <td className="py-1.5 pr-3">{m.created_by_name ?? "—"}</td>
                    <td className="whitespace-nowrap py-1.5">{when(m.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
