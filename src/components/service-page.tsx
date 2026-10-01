/**
 * Service phase A (docs/service-module-design.md §5.1, §6): repair tickets. Without an id the
 * page lists tickets grouped by stage (Open → Closed), filterable, with a Recently deleted bin,
 * like the Bids / Takeoffs pages; `?new=1` opens a blank ticket and `?id=<uuid>` an existing
 * one, both on one screen in the order of §5.1. CenterPoint still dispatches and invoices; the
 * ticket carries its CenterPoint ticket / invoice numbers from the legacy system (folded away unless set).
 *
 * A technician (profiles.technician, not admin) receives only their own tickets (RLS), edits
 * them, sets the stage Open / Scheduled / Done only (TECH_STAGES; the office invoices and
 * closes) and never deletes; the server and RLS enforce the same, this only hides what would be
 * refused.
 *
 * The field side (§5.3): `?id=<uuid>&closeout=1` opens the ticket's close-out
 * (components/service/closeout.tsx); the ticket shows its site contact, the repairs, time,
 * signature and timeline the technician recorded (components/service/ticket-field-sections.tsx).
 *
 * Invoicing (§5.4): once a ticket is Done the office sees its invoice on the ticket
 * (components/service/invoice-block.tsx); the ticket's Labor rate picks the hourly rates.
 *
 * Owner, Sep 30: the ticket carries a Job # beside its PO # (both in the header, and on the
 * invoice); the technician select has a "+" to add more named technicians, each with a $ box
 * (blank = the default: their profile rate, else the rate table) — that crew is what the
 * invoice's labor lines bill (lib/invoice-labor.ts). An old ticket with unnamed helpers keeps
 * them until the office names the crew.
 *
 * Owner, Oct 1: the form is one column — the customer block (name with × to change, the site
 * box, the site contact), Description, PO # / Job #, Type / Labor rate / Date, the technician
 * and crew, CenterPoint (folded), Notes. The week grid lives on the Board only; a customer with
 * several sites needs the site picked (lib/ticket-form.ts, also enforced by saveServiceJob).
 *
 * Fewer clicks (owner, Sep 27): the list header links the Done tickets waiting to be
 * invoiced ("N to invoice"); `?new=1&from=<ticket id>` starts a ticket with an earlier ticket's
 * customer side ("New ticket for this site") and `?new=1&account=<id>&site=<id>` with a
 * customer picked (the Customers page).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ServiceTabs } from "@/components/service/service-tabs";
import { EmbeddedBoard } from "@/components/service/board-page";
import { MaterialsSection } from "@/components/service/materials-section";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  CopyPlus,
  Loader2,
  Lock,
  MapPin,
  Package,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { isOffice } from "@/lib/access";
import { TICKET_DATE_REQUIRED } from "@/lib/ticket-date";
import {
  deleteServiceJob,
  getCrewRateDefaults,
  getServiceJob,
  listJobCrew,
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
  type CrewMemberView,
  type ServiceJobInput,
  type ServiceJobWithTech,
  type ServiceStage,
  type ServiceType,
} from "@/lib/service.functions";
import { getAccount, siteAddressLine, type AccountHit } from "@/lib/crm.functions";
import { listTechnicians } from "@/lib/auth.functions";
import { AccountPicker, type AccountPickerValue } from "@/components/crm/account-picker";
import { RATE_KIND_LABELS, RATE_KINDS } from "@/lib/invoices.functions";
import { SiteSelect } from "@/components/crm/site-select";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { autoSiteId, siteProblem, TICKET_STAGE_HINT } from "@/lib/ticket-form";
import { CloseoutScreen } from "@/components/service/closeout";
import { InvoiceBlock } from "@/components/service/invoice-block";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContactSelect, TicketFieldSections } from "@/components/service/ticket-field-sections";
import { FromInspectionNote, TicketExtras } from "@/components/service/ticket-extras";
import {
  LatestContact,
  LogContactButtons,
  NeedsActionStrip,
  UntouchedBadge,
  untouchedKey,
} from "@/components/crm/contact-log";
import { listUntouched, type UntouchedRow } from "@/lib/contact-log.functions";
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
import { RateBox } from "@/components/service/rate-box";
import { fieldKeys } from "@/components/service/field-utils";
import { defaultBillRate, MAX_HELPERS, othersOf } from "@/lib/service-crew";

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
type RateKind = (typeof RATE_KINDS)[number];
const asRateKind = (s: string | null | undefined): RateKind =>
  (RATE_KINDS as readonly string[]).includes(s ?? "") ? (s as RateKind) : "standard";
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
  from,
  account,
  site,
}: {
  id?: string | undefined;
  isNew?: boolean;
  closeout?: boolean | undefined;
  /** New ticket: copy the customer side of this ticket ("New ticket for this site"). */
  from?: string | undefined;
  /** New ticket: start with this customer (and site) picked (from the Customers page). */
  account?: string | undefined;
  site?: string | undefined;
}) {
  if (id) return <TicketLoader id={id} closeout={!!closeout} />;
  if (isNew) {
    if (from) return <NewFromTicket key={from} from={from} />;
    if (account)
      return <NewForAccount key={`${account}|${site ?? ""}`} accountId={account} siteId={site} />;
    return <TicketEditor job={null} />;
  }
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
  // Assigned tickets with no contact logged and not started (query key ["untouched"]).
  const untouchedFn = useServerFn(listUntouched);
  const untouchedQ = useQuery({
    queryKey: ["untouched"],
    queryFn: () => untouchedFn(),
    enabled: !!session,
  });
  const untouched = useMemo(() => {
    const m = new Map<string, UntouchedRow>();
    for (const r of untouchedQ.data ?? [])
      if (r.kind === "ticket") m.set(untouchedKey(r.kind, r.item_id), r);
    return m;
  }, [untouchedQ.data]);

  // A technician (not admin) receives only their own tickets from the server.
  const isTech = !isOffice(profile);
  const officeOrAdmin = !isTech;
  const BOARD_OPEN_KEY = "bid-o-matic:service-board-open";
  const [boardOpen, setBoardOpenState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BOARD_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const setBoardOpen = (f: (v: boolean) => boolean) =>
    setBoardOpenState((v) => {
      const next = f(v);
      try {
        localStorage.setItem(BOARD_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* private window */
      }
      return next;
    });
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
        j.job_number,
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
  // Done = waiting to be invoiced (finalising moves a ticket to Invoiced).
  const toInvoiceCount = jobs.filter((j) => asStage(j.stage) === "done").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Wrench className="h-6 w-6" /> Service tickets
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Repair calls: who, where, which technician and when. A Done ticket is invoiced from the
            ticket itself.
          </p>
          <div className="mt-2">
            <ServiceTabs toInvoice={officeOrAdmin ? toInvoiceCount : 0} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profile?.technician && (
            <Button asChild size="lg" variant="outline" className="text-base">
              <Link to="/service/today">
                <CalendarDays className="mr-2 h-5 w-5" /> My day
              </Link>
            </Button>
          )}
          <Button size="lg" className="text-base font-semibold" onClick={newTicket}>
            <Plus className="mr-2 h-5 w-5" /> New ticket
          </Button>
        </div>
      </div>

      <NeedsActionStrip kinds={["ticket"]} />

      {officeOrAdmin && (
        // Owner, Sep 28: the board sits above the list (five techs by seven days never grows).
        <section className="rounded-lg border" aria-label="Tech Board">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2 text-left font-semibold"
            onClick={() => setBoardOpen((v) => !v)}
            aria-expanded={boardOpen}
          >
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Tech Board
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {boardOpen ? "Hide" : "Show"}
            </span>
          </button>
          {boardOpen && (
            <div className="border-t p-3">
              <EmbeddedBoard />
            </div>
          )}
        </section>
      )}
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
                            untouched={untouched.get(untouchedKey("ticket", j.id))}
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
  untouched,
  onDelete,
}: {
  row: ServiceJobWithTech;
  /** Assigned with no contact logged and not started (listUntouched). */
  untouched?: UntouchedRow | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const stage = asStage(j.stage);
  const meta = [
    j.technician_name ?? "Unassigned",
    j.scheduled_date ? day(j.scheduled_date) : "No date",
    j.centerpoint_ticket ? `CenterPoint #${j.centerpoint_ticket}` : null,
  ].filter(Boolean);
  // Owner, Sep 28: the whole card opens the ticket, as on Bids (no Open button).
  const open = () => void navigate({ to: "/service", search: { id: j.id } });
  return (
    <div
      role="link"
      tabIndex={0}
      title="Open this ticket"
      className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg border p-4 transition-all duration-150 hover:scale-[1.01] hover:border-primary/40 hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            #{j.number} {j.customer_name}
          </span>
          <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium">
            {typeLabel(j.service_type)}
          </Badge>
          <Badge variant={STAGE_BADGE[stage]} className="px-1.5 py-0 text-[11px]">
            {STAGE_LABELS[stage]}
          </Badge>
          {untouched && (
            <UntouchedBadge assignedAt={untouched.assigned_at} limitDays={untouched.limit_days} />
          )}
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
        {onDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            title="Delete this ticket"
            aria-label={`Delete ticket ${j.number}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onKeyDown={(e) => e.stopPropagation()}
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

/** A new ticket starting from another ticket's customer side (see seedFromTicket). */
function NewFromTicket({ from }: { from: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getServiceJob);
  const src = useQuery({
    queryKey: ["service-job", from],
    queryFn: () => getFn({ data: { id: from } }),
    enabled: !!session,
  });
  useEffect(() => {
    if (src.error)
      toast.error(`Could not copy the earlier ticket: ${errText(src.error)}`, { duration: 10_000 });
  }, [src.error]);
  if (src.error)
    return (
      <TicketEditor
        job={null}
        seed={{
          draft: {},
          tone: "error",
          note: `Could not copy the earlier ticket (${errText(src.error)}). Fill this one in by hand.`,
        }}
      />
    );
  if (!src.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Copying the earlier ticket…
      </p>
    );
  return <TicketEditor job={null} seed={seedFromTicket(src.data)} />;
}

/** A new ticket with a customer (and site) already picked, from the Customers page. */
function NewForAccount({ accountId, siteId }: { accountId: string; siteId?: string | undefined }) {
  const { session } = useAuth();
  const getFn = useServerFn(getAccount);
  const detail = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getFn({ data: { id: accountId } }),
    enabled: !!session,
  });
  const siteMissing = !!siteId && !!detail.data && !detail.data.sites.some((x) => x.id === siteId);
  useEffect(() => {
    if (detail.error)
      toast.error(`Could not load the customer: ${errText(detail.error)}`, { duration: 10_000 });
  }, [detail.error]);
  useEffect(() => {
    if (siteMissing)
      toast.error("That site is no longer on file for this customer — pick the site", {
        duration: 10_000,
      });
  }, [siteMissing]);
  if (detail.error)
    return (
      <TicketEditor
        job={null}
        seed={{
          draft: {},
          tone: "error",
          note: `Could not load the customer (${errText(detail.error)}). Pick the customer here.`,
        }}
      />
    );
  if (!detail.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the customer…
      </p>
    );
  const a = detail.data.account;
  // No site asked for: a customer with one site gets it (owner, Oct 1).
  const sites = detail.data.sites;
  const pickId = siteId ?? autoSiteId(sites);
  const site = pickId ? sites.find((x) => x.id === pickId) : undefined;
  const seed: Seed = {
    draft: {
      customer: {
        account_id: a.id,
        site_id: site?.id ?? null,
        label: site ? `${site.name} — ${a.name}` : a.name,
      },
      hit: {
        account_id: a.id,
        account_name: a.name,
        kind: a.kind === "individual" ? "individual" : "company",
        site_id: site?.id ?? null,
        site_name: site?.name ?? null,
        site_address: site ? siteAddressLine(site) : "",
        site_count: sites.length,
        contact_name: a.contact_name,
        phone: a.phone,
      },
    },
    ...(siteMissing
      ? { tone: "error" as const, note: "That site is no longer on file; pick the site." }
      : {}),
  };
  return <TicketEditor job={null} seed={seed} />;
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
  /** Which hourly rates the invoice uses (service_rates). */
  labor_rate_kind: RateKind;
  po_number: string;
  job_number: string;
  /** "" = unassigned. */
  technician_id: string;
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
        labor_rate_kind: asRateKind(job.labor_rate_kind),
        po_number: job.po_number ?? "",
        job_number: job.job_number ?? "",
        technician_id: job.technician_id ?? "",
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
        labor_rate_kind: "standard",
        po_number: "",
        job_number: "",
        technician_id: meId ?? "",
        scheduled_date: "",
        centerpoint_ticket: "",
        centerpoint_invoice: "",
        notes: "",
      };
/** A new ticket's starting values beyond the defaults, with a line saying where they came from. */
interface Seed {
  draft: Partial<Draft>;
  note?: string;
  tone?: "info" | "error";
}

/**
 * "New ticket for this site": the customer side of an earlier ticket (customer, site, contact,
 * PO #, labor rate, type); the description, technician and day start fresh.
 */
const seedFromTicket = (j: ServiceJobWithTech): Seed => ({
  draft: {
    customer: j.account_id
      ? {
          account_id: j.account_id,
          site_id: j.site_id,
          label: j.site_name ? `${j.site_name} — ${j.customer_name}` : j.customer_name,
        }
      : null,
    // Shown in the customer card until the account itself has loaded.
    hit: j.account_id
      ? {
          account_id: j.account_id,
          account_name: j.customer_name,
          kind: "company",
          site_id: j.site_id,
          site_name: j.site_name,
          site_address: j.site_address ?? "",
          // Not known here; the customer's sites load with the block.
          site_count: 0,
          contact_name: null,
          phone: null,
        }
      : null,
    contact_id: j.account_id ? (j.contact_id ?? "") : "",
    po_number: j.po_number ?? "",
    labor_rate_kind: asRateKind(j.labor_rate_kind),
    service_type: asType(j.service_type),
  },
  tone: "info",
  note: j.account_id
    ? `Copied from ticket #${j.number}: customer, site, contact, PO #, labor rate and type. Add the description, then the technician and day.`
    : `Ticket #${j.number} was not linked to a customer profile (“${j.customer_name}”); pick the customer. PO #, labor rate and type are copied.`,
});

/** The named crew on the form: the lead's $ and the other technicians (owner, Sep 30). */
interface CrewDraft {
  lead_rate: number | null;
  others: { key: string; technician_id: string; bill_rate: number | null }[];
}
let crewSeq = 0;
const crewFrom = (rows: readonly CrewMemberView[]): CrewDraft => ({
  lead_rate: rows.find((r) => r.sort === 0)?.bill_rate ?? null,
  others: othersOf(rows).map((r) => ({
    key: `c${++crewSeq}`,
    technician_id: r.technician_id,
    bill_rate: r.bill_rate,
  })),
});
const crewKey = (c: CrewDraft | null) =>
  c ? JSON.stringify([c.lead_rate, c.others.map((o) => [o.technician_id, o.bill_rate])]) : "";

/** The fields that decide "unsaved changes" (the card's hit is display only). */
const draftKey = (d: Draft) =>
  JSON.stringify({
    ...d,
    hit: null,
    customer: d.customer && [d.customer.account_id, d.customer.site_id],
  });

function TicketEditor({ job, seed }: { job: ServiceJobWithTech | null; seed?: Seed }) {
  const { session, profile, can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveServiceJob);
  const stageFn = useServerFn(setServiceStage);
  const deleteFn = useServerFn(deleteServiceJob);
  const techFn = useServerFn(listTechnicians);

  const isTech = !isOffice(profile);
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
      ...seed?.draft,
      technician_id: prefill.tech ?? d.technician_id,
      scheduled_date: prefill.date ?? d.scheduled_date,
    };
  });
  const [savedKey, setSavedKey] = useState(() => draftKey(draft));
  const dirty = draftKey(draft) !== savedKey;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The named crew. An existing ticket's rows load after the ticket; until then (and for a
  // technician, who answers on the close-out instead) nothing about the crew is sent.
  const crewFn = useServerFn(listJobCrew);
  const ratesFn = useServerFn(getCrewRateDefaults);
  const crewQ = useQuery({
    queryKey: fieldKeys.crew(job?.id ?? "new"),
    queryFn: () => crewFn({ data: { id: job!.id } }),
    enabled: !!session && !!job,
  });
  const [crew, setCrew] = useState<CrewDraft | null>(() =>
    job ? null : { lead_rate: null, others: [] },
  );
  const [crewSavedKey, setCrewSavedKey] = useState(() => crewKey(crew));
  useEffect(() => {
    if (crew || !crewQ.data) return;
    const c = crewFrom(crewQ.data);
    setCrew(c);
    setCrewSavedKey(crewKey(c));
  }, [crew, crewQ.data]);
  // An old ticket with unnamed helpers keeps them until the office names the crew.
  const legacyHelpers = !!job && job.helper_count > 0 && crewQ.data?.length === 0;
  const crewDirty = !!crew && crewKey(crew) !== crewSavedKey;
  const sendCrew = officeOrAdmin && !!crew && (!legacyHelpers || crewDirty);
  const rateDefaults = useQuery({
    queryKey: ["crew-rate-defaults", draft.labor_rate_kind],
    queryFn: () => ratesFn({ data: { rate_kind: draft.labor_rate_kind } }),
    enabled: !!session && officeOrAdmin,
    staleTime: 5 * 60_000,
  });
  const ratePlaceholder = (techId: string, isLead: boolean) => {
    const d = rateDefaults.data;
    if (!d) return "default";
    return defaultBillRate(isLead, techId ? d.profiles[techId] : null, d.table).toFixed(2);
  };
  const setOther = (key: string, patch: Partial<CrewDraft["others"][number]>) =>
    setCrew((c) =>
      c ? { ...c, others: c.others.map((o) => (o.key === key ? { ...o, ...patch } : o)) } : c,
    );
  const addOther = () =>
    setCrew((c) =>
      c && c.others.length < MAX_HELPERS
        ? {
            ...c,
            others: [...c.others, { key: `c${++crewSeq}`, technician_id: "", bill_rate: null }],
          }
        : c,
    );
  const removeOther = (key: string) =>
    setCrew((c) => (c ? { ...c, others: c.others.filter((o) => o.key !== key) } : c));
  // The lead is row 0; picking a crew member as the lead takes them out of the others.
  const dropFromCrew = (techId: string) => {
    if (techId)
      setCrew((c) =>
        c ? { ...c, others: c.others.filter((o) => o.technician_id !== techId) } : c,
      );
  };
  const setLead = (techId: string) => {
    set("technician_id", techId);
    dropFromCrew(techId);
  };

  // The customer's sites (the same query the customer block reads): a customer with more than
  // one needs the site picked before the ticket is created or saved (owner, Oct 1).
  const accountFn = useServerFn(getAccount);
  const accountId = draft.customer?.account_id ?? null;
  const accountQ = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => accountFn({ data: { id: accountId! } }),
    enabled: !!session && !!accountId,
  });
  const siteCount =
    accountQ.data?.account.id === accountId
      ? accountQ.data.sites.length
      : (draft.hit?.site_count ?? 0);
  const siteMessage = draft.customer
    ? siteProblem({ siteCount, site_id: draft.customer.site_id })
    : null;
  // The × on the customer block: the search box comes back, focused.
  const [changingCustomer, setChangingCustomer] = useState(false);

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
        // The rate is the office's call; a technician's save leaves it as it is.
        ...(officeOrAdmin ? { labor_rate_kind: draft.labor_rate_kind } : {}),
        po_number: draft.po_number,
        // The job number is the office's (a technician's save leaves it as it is).
        ...(officeOrAdmin ? { job_number: draft.job_number.trim() || null } : {}),
        technician_id: draft.technician_id || null,
        ...(sendCrew && crew
          ? {
              crew: {
                lead_rate: crew.lead_rate,
                others: crew.others
                  .filter((o) => o.technician_id && o.technician_id !== draft.technician_id)
                  .map((o) => ({ technician_id: o.technician_id, bill_rate: o.bill_rate })),
              },
            }
          : {}),
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
      if (sendCrew) {
        setCrewSavedKey(crewKey(crew));
        void qc.invalidateQueries({ queryKey: fieldKeys.crew(row.id) });
      }
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
    if (siteMessage) {
      toast.error(siteMessage);
      return;
    }
    save.mutate();
  };

  const ro = !canEdit;
  // Close-out: the office and the assigned technician (not once the office has invoiced).
  const canCloseOut = !!job && canEdit;
  // Repeat work: once a ticket is Done (or later) the office opens the next one at the same site.
  const repeatable = jobStage === "done" || jobStage === "invoiced" || jobStage === "closed";

  // Section 4's controls, shared by the office layout (under the grid) and the technician's.
  const techSelect = (triggerClass?: string) => (
    <Select
      value={draft.technician_id || "none"}
      disabled={ro}
      onValueChange={(v) => setLead(v === "none" ? "" : v)}
    >
      <SelectTrigger id="ticket-tech" className={triggerClass}>
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
  );
  const techError = techs.error ? (
    <p className="text-xs text-destructive">Could not load technicians: {errText(techs.error)}</p>
  ) : null;
  // The crew under the technician select (office): each other technician with a $ box and ×.
  const pickable = (current: string) =>
    techOptions.filter(
      (t) =>
        t.id === current ||
        (t.id !== draft.technician_id && !crew?.others.some((o) => o.technician_id === t.id)),
    );
  const crewRows = crew && (
    <div className="space-y-2">
      {crew.others.map((o, i) => (
        <div key={o.key} className="flex items-center gap-2">
          <Select
            value={o.technician_id || "none"}
            disabled={ro}
            onValueChange={(v) => setOther(o.key, { technician_id: v === "none" ? "" : v })}
          >
            <SelectTrigger className="h-9 min-w-0 flex-1" aria-label={`Technician ${i + 2}`}>
              <SelectValue placeholder="Pick a technician" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Pick a technician</SelectItem>
              {pickable(o.technician_id).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {t.technician ? "" : " (office)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="w-28 shrink-0">
            <RateBox
              aria-label={`Bill rate for technician ${i + 2}, dollars per hour`}
              title="$ per labor hour on this ticket; blank = the default shown"
              className="h-9"
              placeholder={ratePlaceholder(o.technician_id, false)}
              value={o.bill_rate}
              disabled={ro}
              onChange={(v) => setOther(o.key, { bill_rate: v })}
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove technician ${i + 2}`}
            title="Remove from the crew"
            disabled={ro}
            onClick={() => removeOther(o.key)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {legacyHelpers && crew.others.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {job?.helper_count} unnamed helper{(job?.helper_count ?? 0) > 1 ? "s" : ""} (an older
          ticket), billed at the helper rate. Add the technicians with + to name them instead.
        </p>
      )}
    </div>
  );
  // The $ / hour box and the "+" wait for a technician (owner, Oct 1).
  const showRate = !!crew && !!draft.technician_id;
  const techRow = (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">{techSelect("h-9")}</div>
      {crew && showRate && (
        <>
          <div className="w-28 shrink-0">
            <RateBox
              aria-label="Bill rate for the technician, dollars per hour"
              title="$ per labor hour on this ticket; blank = the default shown"
              className="h-9"
              placeholder={ratePlaceholder(draft.technician_id, true)}
              value={crew.lead_rate}
              disabled={ro}
              onChange={(v) => setCrew((c) => (c ? { ...c, lead_rate: v } : c))}
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0"
            aria-label="Add another technician"
            title="Add another technician to this ticket"
            disabled={ro || crew.others.length >= MAX_HELPERS}
            onClick={addOther}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
  // A technician sees the crew by name (they answer who is on the job on the close-out).
  const crewNames = (crewQ.data ?? []).filter((r) => r.sort !== 0).map((r) => r.name);
  // Every ticket has a date (owner, Oct 1): the office cannot create or save one without.
  const dateMissing = !draft.scheduled_date;
  const dateInput = (
    <div className="space-y-1">
      <Input
        id="ticket-date"
        type="date"
        required
        aria-invalid={dateMissing || undefined}
        className={dateMissing ? "border-destructive" : undefined}
        value={draft.scheduled_date}
        disabled={ro}
        onChange={(e) => set("scheduled_date", e.target.value)}
      />
      {dateMissing && !ro && <p className="text-xs text-destructive">{TICKET_DATE_REQUIRED}</p>}
    </div>
  );

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
              {officeOrAdmin && repeatable && (
                <Button asChild variant="outline">
                  <Link
                    to="/service"
                    search={{ new: 1, from: job.id }}
                    title={
                      job.site_id ? "New ticket for this site" : "New ticket for this customer"
                    }
                  >
                    <CopyPlus className="mr-1 h-4 w-4" />
                    Repeat
                  </Link>
                </Button>
              )}
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
          <p className="flex flex-wrap gap-x-4 text-sm" aria-label="Ticket numbers">
            <span>
              <span className="text-muted-foreground">Ticket # </span>
              <span className="tabular-nums">{job.number}</span>
            </span>
            <span>
              <span className="text-muted-foreground">PO # </span>
              {job.po_number || "—"}
            </span>
            <span>
              <span className="text-muted-foreground">Job # </span>
              {job.job_number || "—"}
            </span>
          </p>
        )}
        {job && (
          <p className="text-xs text-muted-foreground">
            Updated {when(job.updated_at)}
            {job.updated_by_name ? ` by ${job.updated_by_name}` : ""}
          </p>
        )}
        {job && <FromInspectionNote job={job} />}
        {!job && seed?.note && (
          <p
            className={
              seed.tone === "error"
                ? "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {seed.note}
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
        className="max-w-3xl space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* One column (owner, Oct 1): customer block → description → PO / Job # → type, labor
            rate and date → technician and crew → CenterPoint (folded) → notes → Create. */}
        {/* 1. The customer: the search box until one is picked, then one block with the name
            (× to change), the site and the site contact. */}
        <div className="space-y-1">
          <Label htmlFor={draft.customer ? undefined : "ticket-customer"}>Customer</Label>
          {draft.customer ? (
            <CustomerBlock
              accountId={draft.customer.account_id}
              siteId={draft.customer.site_id}
              hit={draft.hit}
              contactId={draft.contact_id}
              siteMessage={siteMessage}
              disabled={ro}
              onChangeCustomer={() => {
                setChangingCustomer(true);
                setDraft((d) => ({ ...d, customer: null, hit: null, contact_id: "" }));
              }}
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
              onContact={(v) => set("contact_id", v)}
            />
          ) : (
            <>
              <AccountPicker
                id="ticket-customer"
                value={null}
                autoFocus={!job || changingCustomer}
                disabled={ro}
                placeholder="Search a customer (e.g. bell county)…"
                onChange={(hit) =>
                  setDraft((d) => ({
                    ...d,
                    hit,
                    // Another customer's contacts do not apply.
                    contact_id:
                      hit && job?.account_id === hit.account_id ? (job.contact_id ?? "") : "",
                    // A customer with one site comes with it (lib/account-search.ts).
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
              {job?.customer_name && !job.account_id && (
                <p className="text-xs text-muted-foreground">
                  Not linked to a customer profile: “{job.customer_name}”. Pick or add one to link
                  it.
                </p>
              )}
            </>
          )}
        </div>
        {job && (
          // Owner, Sep 28: log each call / text / email / visit so the office sees the
          // customer has been reached (and the ticket leaves the untouched list).
          <section
            className="space-y-2 rounded-lg border p-3 text-sm"
            aria-label="Customer contact"
          >
            <p className="flex items-center gap-1.5 font-medium">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Customer contact
            </p>
            <LogContactButtons kind="ticket" itemId={job.id} />
            <LatestContact kind="ticket" itemId={job.id} />
          </section>
        )}

        {/* 2. Description */}
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

        {/* 3. PO # and Job # */}
        <div className="grid gap-4 sm:grid-cols-2">
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
          {officeOrAdmin && (
            <div className="space-y-1">
              <Label htmlFor="ticket-job-number">Job #</Label>
              <Input
                id="ticket-job-number"
                value={draft.job_number}
                disabled={ro}
                maxLength={60}
                title="Printed on this ticket's invoices as the Job #"
                onChange={(e) => set("job_number", e.target.value)}
              />
            </div>
          )}
        </div>

        {/* 4. Type, labor rate and date on one row (owner, Oct 1) */}
        <div className={`grid gap-4 ${officeOrAdmin ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
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
          {officeOrAdmin && (
            <div className="space-y-1">
              <Label htmlFor="ticket-rate">Labor rate</Label>
              <Select
                value={draft.labor_rate_kind}
                disabled={ro}
                onValueChange={(v) => set("labor_rate_kind", asRateKind(v))}
              >
                <SelectTrigger
                  id="ticket-rate"
                  title={`Sets the hourly rates on the invoice${job?.invoice_id ? " (rebuild a draft invoice after changing it)" : ""}.`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {RATE_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="ticket-date">Date</Label>
            {dateInput}
          </div>
        </div>

        {/* 5. Technician and crew. The Board keeps the week grid; here the select and the date
            above set them (owner, Oct 1). */}
        {officeOrAdmin ? (
          <div className="space-y-2 sm:max-w-[460px]">
            <div className="flex items-end justify-between gap-2">
              <Label htmlFor="ticket-tech">
                Technician{crew && crew.others.length > 0 ? "s" : ""}
              </Label>
              {showRate && (
                <span className="mr-11 w-28 text-xs text-muted-foreground">$ / hour</span>
              )}
            </div>
            {techRow}
            {crewRows}
            {crewQ.error && (
              <p className="text-xs text-destructive">
                Could not load the crew: {errText(crewQ.error)}
              </p>
            )}
            {techError}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ticket-tech">Technician</Label>
              {techSelect()}
              {techError}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">Crew</p>
              <p className="flex min-h-9 items-center text-sm">
                {crewNames.length
                  ? crewNames.join(", ")
                  : job?.crew_confirmed_at
                    ? "Alone"
                    : job && job.helper_count > 0
                      ? `${job.helper_count} helper${job.helper_count > 1 ? "s" : ""}`
                      : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Change it on the close-out.</p>
            </div>
          </div>
        )}

        {/* 6. CenterPoint numbers: folded away unless the ticket carries one */}
        <Collapsible
          defaultOpen={!!(draft.centerpoint_ticket || draft.centerpoint_invoice)}
          className="space-y-2"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="group -ml-2 h-8 px-2 text-sm font-medium"
            >
              <ChevronRight className="mr-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
              CenterPoint numbers
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid max-w-md grid-cols-2 gap-3">
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
          </CollapsibleContent>
        </Collapsible>

        {/* 7. Notes: two rows to start, growing as they are typed (owner, Oct 1) */}
        <div className="space-y-1">
          <Label htmlFor="ticket-notes">Notes</Label>
          <AutoTextarea
            id="ticket-notes"
            rows={2}
            value={draft.notes}
            disabled={ro}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>

        {!ro && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="lg"
              disabled={
                save.isPending || (!!job && !dirty && !crewDirty) || dateMissing || !!siteMessage
              }
            >
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {job ? "Save" : "Create ticket"}
            </Button>
            {job && (dirty || crewDirty) && (
              <span className="text-sm text-muted-foreground">Unsaved changes</span>
            )}
            {!job && <span className="text-xs text-muted-foreground">{TICKET_STAGE_HINT}</span>}
          </div>
        )}
      </form>

      {job && (
        // Owner, Sep 28 ("so much crap on it"): the sections below the form fold away with a
        // one-line summary each; the open state is remembered per section.
        <div className="space-y-4">
          <TicketExtras job={job} canEdit={canEdit} />
          {officeOrAdmin && <InvoiceBlock job={job} />}

          {can("service") || can("inventory") || can("estimate") ? (
            // Owner, Sep 28: log material here, on the ticket, never on the Inventory page.
            // Open for a technician on an Open / Scheduled ticket (they log here), else folded.
            <MaterialsSection
              jobId={job.id}
              collapsible
              defaultOpen={isTech && (jobStage === "open" || jobStage === "scheduled")}
            />
          ) : (
            <MaterialsUsed jobId={job.id} canLog={false} />
          )}

          <TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} />
        </div>
      )}

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
  const text = "JBK Portal numbers start at 6000 so they never collide with CenterPoint's";
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

/**
 * The picked customer as one block (owner, Oct 1): the name (opens the customer) with an × to
 * change it, then the site box (required when the customer has several sites; one site comes
 * with the pick), the site's technician instructions, and the site contact with their phone.
 */
function CustomerBlock(props: {
  accountId: string;
  siteId: string | null;
  hit: AccountHit | null;
  contactId: string;
  /** Why the site still needs picking (lib/ticket-form.ts siteProblem), or null. */
  siteMessage: string | null;
  disabled: boolean;
  onChangeCustomer: () => void;
  onPickSite: (site: { id: string; name: string }, accountName: string) => void;
  onContact: (id: string) => void;
}) {
  const { session } = useAuth();
  const getFn = useServerFn(getAccount);
  const accountId = props.accountId;
  const detail = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getFn({ data: { id: accountId } }),
    enabled: !!session,
  });
  const a = detail.data?.account;
  const site = props.siteId ? detail.data?.sites.find((s) => s.id === props.siteId) : undefined;
  const name = a?.name ?? props.hit?.account_name ?? "";
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/customers"
          search={{ id: accountId }}
          className="min-w-0 truncate text-base font-medium underline-offset-2 hover:underline"
          title="Open this customer"
        >
          {name || "Customer"}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {detail.isLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {!props.disabled && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground"
              title="Change the customer"
              aria-label="Change the customer"
              onClick={props.onChangeCustomer}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {detail.error && (
        <p className="text-xs text-destructive">
          Could not load the customer: {errText(detail.error)}
        </p>
      )}
      {(() => {
        // The customer's own contact and numbers (the site contact is picked below).
        const who = a?.contact_name ?? props.hit?.contact_name ?? null;
        const phones = [a?.mobile ?? null, a?.phone ?? props.hit?.phone ?? null].filter(Boolean);
        if (!who && !phones.length) return null;
        return (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {who && <span className="text-foreground">{who}</span>}
            {phones.map((ph) => (
              <a key={ph} href={`tel:${ph}`} className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" /> {ph}
              </a>
            ))}
          </p>
        );
      })()}
      <div className="space-y-1">
        <label htmlFor="ticket-site" className="text-xs font-medium">
          Site
        </label>
        <SiteSelect
          id="ticket-site"
          accountId={accountId}
          value={props.siteId}
          required
          invalid={!!props.siteMessage}
          disabled={props.disabled}
          className="bg-background"
          onChange={(s) => {
            if (s) props.onPickSite(s, name);
          }}
        />
        {props.siteMessage && !props.disabled && (
          <p className="text-xs text-destructive">{props.siteMessage}</p>
        )}
        {site?.technician_instructions && (
          <p className="whitespace-pre-line rounded border bg-background px-2 py-1 text-xs">
            <span className="font-medium">Technician instructions: </span>
            {site.technician_instructions}
          </p>
        )}
      </div>
      <ContactSelect
        accountId={accountId}
        siteId={props.siteId}
        value={props.contactId}
        disabled={props.disabled}
        onChange={props.onContact}
      />
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
