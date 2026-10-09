/**
 * Service phase A (docs/service-module-design.md §5.1, §6): repair tickets. Without an id the
 * page lists tickets grouped by stage (Open → Closed), filterable, with a Recently deleted bin,
 * like the Bids / Takeoffs pages; `?new=1` opens a blank ticket and `?id=<uuid>` an existing
 * one, both on one screen in the order of §5.1. CenterPoint still dispatches and invoices; the
 * ticket carries its CenterPoint ticket / invoice numbers from the legacy system (folded away unless set).
 *
 * A technician (profiles.technician, not admin) receives only their own tickets (RLS), edits
 * them, sets the stage Open / Scheduled / Done only (TECH_STAGES) and never deletes; Invoiced
 * and Closed are a manager's or an admin's (ticket-stage.ts; owner, Oct 1). The server, RLS and
 * a database trigger enforce the same, this only hides what would be refused.
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
 * customer picked (the Customers page). `?new=1&opportunity=<id>` (an opportunity's "Start a
 * ticket", owner Oct 2) starts one with the opportunity's customer, site and description; the
 * ticket keeps the opportunity (from_opportunity_id) and says "From opportunity: <title>".
 *
 * Owner, Oct 1 ("The manager creates the tickets; reps do not create tickets"; "only the
 * managers / admins can see and edit the prices"): New ticket / `?new=1`, Repeat, the Board,
 * the technician select and crew with its $ / hour boxes, the Labor rate, the invoice and
 * Delete / Restore are `managesTickets` (admin or manager). Everyone else reads the technician
 * and crew by name. `isOffice` / `officeOrAdmin` decide only what is seen and the layout.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ServiceTabs } from "@/components/service/service-tabs";
import { MaterialsSection } from "@/components/service/materials-section";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Check,
  CheckCheck,
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
  Target,
  Trash2,
  Wrench,
  Columns2,
  Rows2,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { canClaim, isOffice, managesTickets, seesEveryone, seesInvoices } from "@/lib/access";
import { TICKET_DATE_REQUIRED } from "@/lib/ticket-date";
import { canCloseOut, stageChoices, stageLocked } from "@/lib/ticket-stage";
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
  claimServiceJob,
} from "@/lib/service.functions";
import { getAccount, siteAddressLine, type AccountHit } from "@/lib/crm.functions";
import { getOpportunity, type OpportunityWithNames } from "@/lib/opportunities.functions";
import { fromOpportunityLabel, ticketSeedFromOpportunity } from "@/lib/opportunity-form";
import { listTechnicians } from "@/lib/auth.functions";
import { listJobEvents } from "@/lib/service-field.functions";
import { openedLine, openerName, shortDate, ticketStageStrip } from "@/lib/stage-dates";
import { StageStrip } from "@/components/stage-strip";
import { FIELD_TONE_LABELS, STAGE_TONES, stageMark, ticketToneKey } from "@/lib/stage-colors";
import { AccountPicker, type AccountPickerValue } from "@/components/crm/account-picker";
import { RATE_KIND_LABELS, RATE_KINDS } from "@/lib/invoices.functions";
import { SiteSelect } from "@/components/crm/site-select";
import { PropertySiteSelect } from "@/components/crm/property-site-select";
import { CountyCodeLine } from "@/components/crm/county-code-picker";
import { WarrantyBadges } from "@/components/crm/site-warranties";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { autoSiteId, siteProblem, TICKET_STAGE_HINT } from "@/lib/ticket-form";
import type { StageFilter } from "@/lib/service-search";
import { localYmd } from "@/lib/tasks";
import { SERVICE_OPEN_WORK, ticketOverdueDays } from "@/lib/work-counts";
import {
  ARRIVAL_ANY,
  ARRIVAL_LABELS,
  ARRIVAL_WINDOWS,
  asArrival,
  dayWithWindow,
} from "@/lib/arrival-window";
import {
  filterTickets,
  techChoices,
  TECH_ALL,
  TECH_UNASSIGNED,
  type TechFilter,
} from "@/lib/ticket-list-filter";
import { OverdueBadge } from "@/components/overdue-badge";
import { CloseoutScreen } from "@/components/service/closeout";
import { InvoiceBlock } from "@/components/service/invoice-block";
import { PurchaseOrdersSection } from "@/components/service/purchase-orders-section";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContactSelect,
  TicketFieldSections,
  TicketRepairs,
} from "@/components/service/ticket-field-sections";
import { FromInspectionNote, TicketExtras } from "@/components/service/ticket-extras";
import { AerialSection } from "@/components/service/aerial-markup";
import { InspectionSection } from "@/components/service/inspection-section";
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

/**
 * A ticket's stage as a coloured badge (owner, Oct 6: stage-colors.ts, CenterPoint's colour
 * families; Done ✓, Authorized ✓✓).
 */
/** The stage strip's dot colour per stage (stage-colors.ts). */
const STAGE_DOTS: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_TONES).map(([k, t]) => [k, t.dot]),
);

function StageBadge({
  stage,
  fieldStatus,
}: {
  stage: ServiceStage;
  fieldStatus: string | null | undefined;
}) {
  const key = ticketToneKey({ stage, field_status: fieldStatus });
  const mark = stageMark(stage);
  return (
    <Badge variant="outline" className={`gap-0.5 px-1.5 py-0 text-[11px] ${STAGE_TONES[key].chip}`}>
      {mark === "check" && <Check className="h-3 w-3" aria-hidden />}
      {mark === "double-check" && <CheckCheck className="h-3 w-3" aria-hidden />}
      {STAGE_LABELS[stage]}
    </Badge>
  );
}

export function ServicePage({
  id,
  isNew,
  closeout,
  from,
  account,
  site,
  opportunity,
  stage,
  overdue,
}: {
  id?: string | undefined;
  isNew?: boolean;
  closeout?: boolean | undefined;
  /** New ticket: copy the customer side of this ticket ("New ticket for this site"). */
  from?: string | undefined;
  /** New ticket: start with this customer (and site) picked (from the Customers page). */
  account?: string | undefined;
  site?: string | undefined;
  /** New ticket: from this opportunity (its customer, site and description). */
  opportunity?: string | undefined;
  /** The list: preset the stage chip (`?stage=`; "openwork" = open + scheduled + done). */
  stage?: Exclude<StageFilter, "all"> | undefined;
  /** The list: preset the Overdue filter (`?overdue=1`, the Customers page counts strip). */
  overdue?: boolean | undefined;
}) {
  const { profile } = useAuth();
  if (id) return <TicketLoader id={id} closeout={!!closeout} />;
  if (isNew) {
    // Owner, Oct 1: "The manager creates the tickets; reps do not create tickets" (the server
    // refuses too: saveServiceJob "Only a manager creates tickets").
    if (!profile) return null;
    if (!managesTickets(profile)) return <ManagersCreateTickets />;
    if (from) return <NewFromTicket key={from} from={from} />;
    if (opportunity) return <NewForOpportunity key={opportunity} id={opportunity} />;
    if (account)
      return <NewForAccount key={`${account}|${site ?? ""}`} accountId={account} siteId={site} />;
    return <TicketEditor job={null} />;
  }
  // Keyed on the preset so following another counts-strip link re-applies it.
  return (
    <ServiceList
      key={`${stage ?? ""}|${overdue ? 1 : 0}`}
      presetStage={stage}
      presetOverdue={!!overdue}
    />
  );
}

/** `?new=1` for anyone but a manager: the same "sent away" card as the Board and Invoices. */
function ManagersCreateTickets() {
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">A manager creates tickets.</p>
      <p className="text-sm text-muted-foreground">
        Your tickets are the ones assigned to you, on the Service list and on Today.
      </p>
      <Button asChild>
        <Link to="/service">Back to tickets</Link>
      </Button>
    </div>
  );
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

type TypeFilter = "all" | ServiceType;

function ServiceList({
  presetStage,
  presetOverdue,
}: {
  presetStage?: Exclude<StageFilter, "all"> | undefined;
  presetOverdue: boolean;
}) {
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
  // Owner, Oct 1: "The manager creates the tickets": New ticket, the Board (dispatch), delete
  // and restore are a manager's; the to-invoice count shows to whoever sees invoices.
  const manager = managesTickets(profile);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>(presetStage ?? "all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // One technician's tickets (service study M7, owner Oct 5), office only.
  const [techFilter, setTechFilter] = useState<TechFilter>(TECH_ALL);
  // Overdue: open tickets whose day has passed (lib/work-counts.ts isOverdueTicket), preset by
  // ?overdue=1 from the Customers page counts strip; cleared from its chip.
  const [overdueOnly, setOverdueOnly] = useState(presetOverdue);
  const today = localYmd(new Date());
  // "Mine" defaults on for a technician admin; null = not touched yet (follow the profile). A
  // plain technician has no Mine filter: the list is already only theirs. A counts-strip link
  // starts with Mine off, so the list shows what the tile counted.
  const [mineOverride, setMineOverride] = useState<boolean | null>(
    presetStage || presetOverdue ? false : null,
  );
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
  const techs = techChoices(jobs);
  // Unknown stage / type values read as Open / Other, as everywhere on this screen.
  const filtered = filterTickets(
    jobs.map((j) => ({ ...j, stage: asStage(j.stage), service_type: asType(j.service_type) })),
    {
      mineId: mine ? (profile?.id ?? null) : null,
      stage: stageFilter,
      overdueOnly,
      type: typeFilter,
      tech: isTech ? TECH_ALL : techFilter,
      search,
      today,
    },
  );
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
  const anyFilter =
    q !== "" ||
    stageFilter !== "all" ||
    typeFilter !== "all" ||
    techFilter !== TECH_ALL ||
    mine ||
    overdueOnly;
  const clearFilters = () => {
    setSearch("");
    setStageFilter("all");
    setOverdueOnly(false);
    setTypeFilter("all");
    setTechFilter(TECH_ALL);
    setMineOverride(false);
  };
  const newTicket = () => void navigate({ to: "/service", search: { new: 1 } });

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
            Repair calls: who, where, which technician and when. A Done ticket is authorized, then
            invoiced from the ticket itself.
          </p>
          <div className="mt-2">
            <ServiceTabs />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profile?.technician && (
            <Button asChild size="lg" variant="outline" className="text-base">
              <Link to="/service/today">
                <CalendarDays className="mr-2 h-5 w-5" /> My tickets
              </Link>
            </Button>
          )}
          {manager && (
            <Button size="lg" className="text-base font-semibold" onClick={newTicket}>
              <Plus className="mr-2 h-5 w-5" /> New ticket
            </Button>
          )}
        </div>
      </div>

      <NeedsActionStrip kinds={["ticket"]} />

      {/* The Tech Board is its own tab (owner, Oct 5); it used to sit folded here above the list. */}
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
                    placeholder="Ticket #, customer, property, description, CenterPoint #…"
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
                {!isTech && (
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Technician
                    <Select value={techFilter} onValueChange={(v) => setTechFilter(v)}>
                      <SelectTrigger className="w-[190px] bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TECH_ALL}>All technicians</SelectItem>
                        <SelectItem value={TECH_UNASSIGNED}>Unassigned</SelectItem>
                        {techs.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={stageFilter === "all"} onClick={() => setStageFilter("all")}>
                  All stages
                </Chip>
                <Chip
                  active={stageFilter === SERVICE_OPEN_WORK}
                  onClick={() =>
                    setStageFilter(stageFilter === SERVICE_OPEN_WORK ? "all" : SERVICE_OPEN_WORK)
                  }
                >
                  Open work
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
                {overdueOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 rounded-full px-3 text-xs"
                    title="Only open tickets whose day has passed. Click to show all."
                    onClick={() => setOverdueOnly(false)}
                  >
                    Overdue <X className="ml-1 h-3 w-3" aria-hidden />
                    <span className="sr-only">(clear)</span>
                  </Button>
                )}
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
              {manager && (
                <Button variant="outline" className="mt-4" onClick={newTicket}>
                  Open the first ticket
                </Button>
              )}
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
                            today={today}
                            onDelete={manager ? () => setToDelete(j) : undefined}
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
                  {manager && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(j.id)}
                    >
                      <RotateCcw className="mr-1 h-4 w-4" />
                      Restore
                    </Button>
                  )}
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
  today,
  onDelete,
}: {
  row: ServiceJobWithTech;
  /** The list's day (the Overdue filter's): an open ticket whose day has passed shows "Overdue". */
  today: string;
  /** Assigned with no contact logged and not started (listUntouched). */
  untouched?: UntouchedRow | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const stage = asStage(j.stage);
  // Owner, Oct 6: the pertinent details at a glance, no money — technician, day, Job #, PO # (the
  // ticket's own, not a materials PO), CenterPoint #; the stage date beside the stage.
  const meta = [
    j.technician_name ?? "Unassigned",
    j.scheduled_date ? dayWithWindow(day(j.scheduled_date), j.arrival_window) : "No date",
    j.job_number ? `Job # ${j.job_number}` : null,
    j.po_number ? `PO # ${j.po_number}` : null,
    j.centerpoint_ticket ? `CenterPoint #${j.centerpoint_ticket}` : null,
  ].filter(Boolean);
  const cityState = [j.site_city, j.site_state].filter((x) => x && x.trim()).join(", ");
  const place = [j.site_name, j.location_name].filter(Boolean).join(" › ");
  const since = shortDate(j.stage_changed_at);
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
          <StageBadge stage={stage} fieldStatus={j.field_status} />
          {since && (
            <span className="text-xs text-muted-foreground" title="The day it entered this stage">
              since {since}
            </span>
          )}
          <OverdueBadge days={ticketOverdueDays({ ...j, stage }, today)} what="Was due" />
          {untouched && (
            <UntouchedBadge assignedAt={untouched.assigned_at} limitDays={untouched.limit_days} />
          )}
        </div>
        {(place || cityState) && (
          <p className="inline-flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {place && <span className="text-foreground">{place}</span>}
            {place && cityState ? " · " : ""}
            {cityState}
          </p>
        )}
        {j.description && <p className="text-sm">{j.description}</p>}
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

/**
 * A new ticket from an opportunity's "Start a ticket" (owner, Oct 2): its customer and site as
 * the Customers page passes them (NewForAccount), its description, and the link back
 * (from_opportunity_id, written when the ticket is created).
 */
function NewForOpportunity({ id }: { id: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getOpportunity);
  const opp = useQuery({
    queryKey: ["opportunity", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !!session,
  });
  useEffect(() => {
    if (opp.error)
      toast.error(`Could not load the opportunity: ${errText(opp.error)}`, { duration: 10_000 });
  }, [opp.error]);
  if (opp.error)
    return (
      <TicketEditor
        job={null}
        seed={{
          draft: {},
          tone: "error",
          note: `Could not load the opportunity (${errText(opp.error)}). Fill this one in by hand.`,
        }}
      />
    );
  if (!opp.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the opportunity…
      </p>
    );
  const o = opp.data;
  if (o.account_id)
    return (
      <NewForAccount accountId={o.account_id} siteId={o.site_id ?? undefined} opportunity={o} />
    );
  // An older opportunity without a customer: the description and the link only.
  const pf = ticketSeedFromOpportunity(o);
  return (
    <TicketEditor
      job={null}
      seed={{
        draft: { description: pf.description },
        from_opportunity_id: pf.from_opportunity_id,
        tone: "info",
        note: `${fromOpportunityLabel(o.title)}. Pick the customer, then the technician and day.`,
      }}
    />
  );
}

/**
 * A new ticket with a customer (and site) already picked, from the Customers page — or from an
 * opportunity (its description and from_opportunity_id too).
 */
function NewForAccount({
  accountId,
  siteId,
  opportunity,
}: {
  accountId: string;
  siteId?: string | undefined;
  opportunity?: OpportunityWithNames | undefined;
}) {
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
      toast.error("That property is no longer on file for this customer — pick the property", {
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
  const fromOpp = opportunity ? ticketSeedFromOpportunity(opportunity) : null;
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
      ...(fromOpp ? { description: fromOpp.description } : {}),
    },
    ...(fromOpp ? { from_opportunity_id: fromOpp.from_opportunity_id } : {}),
    ...(siteMissing
      ? { tone: "error" as const, note: "That property is no longer on file; pick the property." }
      : opportunity
        ? {
            tone: "info" as const,
            note: `${fromOpportunityLabel(opportunity.title)}: customer, property and description filled in. Add the technician and day.`,
          }
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
  /** The site inside the property (property_sites; owner, Oct 6); "" = none. */
  location_id: string;
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
  /** "" = any time (lib/arrival-window.ts). */
  arrival_window: string;
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
        location_id: job.location_id ?? "",
        description: job.description,
        service_type: asType(job.service_type),
        labor_rate_kind: asRateKind(job.labor_rate_kind),
        po_number: job.po_number ?? "",
        job_number: job.job_number ?? "",
        technician_id: job.technician_id ?? "",
        scheduled_date: job.scheduled_date ?? "",
        arrival_window: job.arrival_window ?? "",
        centerpoint_ticket: job.centerpoint_ticket ?? "",
        centerpoint_invoice: job.centerpoint_invoice ?? "",
        notes: job.notes ?? "",
      }
    : {
        customer: null,
        hit: null,
        contact_id: "",
        location_id: "",
        description: "",
        service_type: "leak",
        labor_rate_kind: "standard",
        po_number: "",
        job_number: "",
        technician_id: meId ?? "",
        scheduled_date: "",
        arrival_window: "",
        centerpoint_ticket: "",
        centerpoint_invoice: "",
        notes: "",
      };
/** A new ticket's starting values beyond the defaults, with a line saying where they came from. */
interface Seed {
  draft: Partial<Draft>;
  note?: string;
  tone?: "info" | "error";
  /** "Start a ticket": the opportunity the new ticket keeps (service_jobs.from_opportunity_id). */
  from_opportunity_id?: string;
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
    location_id: j.account_id ? (j.location_id ?? "") : "",
    po_number: j.po_number ?? "",
    labor_rate_kind: asRateKind(j.labor_rate_kind),
    service_type: asType(j.service_type),
  },
  tone: "info",
  note: j.account_id
    ? `Copied from ticket #${j.number}: customer, property, contact, PO #, labor rate and type. Add the description, then the technician and day.`
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

/**
 * The office ticket's layout on a wide screen (owner, Oct 6): the folding sections (Aerial,
 * Materials, Purchase orders …) beside the form ("side", as since Oct 1) or below it
 * ("stacked"). Remembered on this device; read after mount so the server's first paint matches.
 */
type TicketLayout = "side" | "stacked";
/** Side by side on xl: the form ~60 %, the sections ≥ 380 px and in view (owner, Oct 1). */
const SIDE_PANES =
  "space-y-6 xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)] xl:items-start xl:gap-8 xl:space-y-0";
const SIDE_ASIDE = "min-w-0 space-y-4 xl:sticky xl:top-4 xl:min-w-[380px]";
/** Stacked: the form, then the sections, one column as wide as the form. */
const STACKED_PANES = "mx-auto max-w-5xl space-y-6";
const STACKED_ASIDE = "min-w-0 space-y-4";
const TICKET_LAYOUT_KEY = "bid-o-matic:ticket-layout";
function useTicketLayout(): [TicketLayout, (l: TicketLayout) => void] {
  const [layout, setLayout] = useState<TicketLayout>("side");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TICKET_LAYOUT_KEY) === "stacked") setLayout("stacked");
    } catch {
      // Storage blocked: side by side.
    }
  }, []);
  const set = (l: TicketLayout) => {
    setLayout(l);
    try {
      window.localStorage.setItem(TICKET_LAYOUT_KEY, l);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };
  return [layout, set];
}

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
  // Owner, Oct 8: an office person ticked Technician takes an unassigned ticket for themselves.
  const claimFn = useServerFn(claimServiceJob);
  const claimMut = useMutation({
    mutationFn: (id: string) => claimFn({ data: { id, date: null } }),
    onSuccess: (row) => {
      toast.success("Yours — it is on your list now");
      // The draft follows the claim at once (the page's own save would otherwise send the old,
      // empty technician back).
      set("technician_id", row.technician_id ?? "");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message || "Could not claim the ticket"),
  });
  // Owner, Oct 1: dispatch (technician, crew), every rate (crew $/hour, labor rate), Repeat (a
  // new ticket) and Delete are a manager's; officeOrAdmin is visibility and layout only.
  const manager = managesTickets(profile);
  const jobStage = job ? asStage(job.stage) : null;
  // Invoiced / Closed are the office's; a technician's ticket there is read-only for them (the
  // server refuses a technician's save of those stages).
  const officeStage = isTech && !!jobStage && !TECH_STAGES.includes(jobStage);
  const canEdit = !job || officeOrAdmin || (job.technician_id === profile?.id && !officeStage);
  // Owner, Oct 1: Invoiced and Closed are a manager's. Anyone else is offered them only as the
  // ticket's current stage, and then the picker is read-only (the server and the database
  // refuse the same; an invoice sets them through its own path).
  const stageOptions: readonly ServiceStage[] = stageChoices(profile, jobStage);
  const lockedStage = stageLocked(profile, jobStage);

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
  const [layout, setLayout] = useTicketLayout();

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
  const sendCrew = manager && !!crew && (!legacyHelpers || crewDirty);
  const rateDefaults = useQuery({
    queryKey: ["crew-rate-defaults", draft.labor_rate_kind],
    queryFn: () => ratesFn({ data: { rate_kind: draft.labor_rate_kind } }),
    enabled: !!session && manager,
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

  // Owner, Oct 1: "Opened <date> by <name>" under the title and the stage strip, each stage with
  // the date it was last entered — from the timeline's 'stage' rows, which the database writes
  // on every change (lib/stage-dates.ts). The same query (and cache) as the Timeline section.
  const eventsFn = useServerFn(listJobEvents);
  const eventsQ = useQuery({
    queryKey: fieldKeys.events(job?.id ?? "new"),
    queryFn: () => eventsFn({ data: { id: job!.id } }),
    enabled: !!session && !!job,
  });
  // A stage set elsewhere (the close-out, an invoice) arrives with the ticket: re-read its dates.
  const seenStage = useRef(job?.stage);
  useEffect(() => {
    if (!job || seenStage.current === job.stage) return;
    seenStage.current = job.stage;
    void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
  }, [job, qc]);
  const stageCells = job ? ticketStageStrip(asStage(job.stage), eventsQ.data ?? []) : [];
  const opened = job
    ? openedLine(job.created_at, openerName(job.created_by, techs.data, eventsQ.data ?? []))
    : "";

  const save = useMutation({
    mutationFn: () => {
      const input: ServiceJobInput = {
        ...(job ? { id: job.id } : {}),
        account_id: draft.customer?.account_id ?? null,
        site_id: draft.customer?.site_id ?? null,
        contact_id: draft.customer ? draft.contact_id || null : null,
        location_id: draft.customer?.site_id ? draft.location_id || null : null,
        // A ticket from before customer profiles keeps its typed name until one is picked.
        ...(!draft.customer && job ? { customer_name: job.customer_name } : {}),
        description: draft.description,
        service_type: draft.service_type,
        // The rate is a manager's call (owner, Oct 1); anyone else's save leaves it as it is.
        ...(manager ? { labor_rate_kind: draft.labor_rate_kind } : {}),
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
        // Sent only when it changed, so a save never touches a window it did not show.
        ...(draft.arrival_window !== (job?.arrival_window ?? "")
          ? { arrival_window: asArrival(draft.arrival_window) }
          : {}),
        // No stage (audit, Oct 2: a stale tab's save sent the stage it had loaded and moved an
        // Invoiced ticket back to Done). The header's picker is the one way to change it; the
        // server keeps the stage, moving an Open ticket that now has a technician and a day to
        // Scheduled itself.
        notes: draft.notes,
        centerpoint_ticket: draft.centerpoint_ticket,
        centerpoint_invoice: draft.centerpoint_invoice,
        // Written on create only (an opportunity's "Start a ticket").
        ...(!job && seed?.from_opportunity_id
          ? { from_opportunity_id: seed.from_opportunity_id }
          : {}),
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
        // A save can move the stage (Open → Scheduled): its date on the strip.
        void qc.invalidateQueries({ queryKey: fieldKeys.events(row.id) });
        setSavedKey(draftKey(draft));
        toast.success(`Ticket #${row.number} saved`);
      } else {
        toast.success(`Ticket #${row.number} created`);
        // The opportunity's header lists it ("Ticket #6004").
        if (row.from_opportunity_id)
          void qc.invalidateQueries({ queryKey: ["opportunity-tickets", row.from_opportunity_id] });
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
      void qc.invalidateQueries({ queryKey: fieldKeys.events(job!.id) });
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
  /** Who the ticket is on right now: the saved ticket's technician; the draft's on a new one. */
  const assignedId = job ? job.technician_id : draft.technician_id;
  // Close-out: the lead technician (not once the office has invoiced) and managers / admins —
  // the server's rule (setJobCrew, ownJob); an office user who is not a manager sees no button.
  const showCloseOut = canCloseOut(profile, job);
  // Repeat work: once a ticket is Done (or later) the office opens the next one at the same site.
  const repeatable = !!jobStage && ["done", "authorized", "invoiced", "closed"].includes(jobStage);

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
  // Once a ticket has a date, only an admin or a manager moves it (owner, Oct 1; the server
  // refuses anyone else with "Only a manager can move the date").
  const dateLocked = !!job?.scheduled_date && !seesEveryone(profile);
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
        readOnly={dateLocked}
        onChange={(e) => {
          if (!dateLocked) set("scheduled_date", e.target.value);
        }}
      />
      {dateLocked && !ro && <p className="text-xs text-muted-foreground">Managers move dates</p>}
      {dateMissing && !ro && <p className="text-xs text-destructive">{TICKET_DATE_REQUIRED}</p>}
    </div>
  );

  // The form's sections. The office lays them out in two columns from md up (owner, Oct 1, "the
  // tighter layout"); a technician keeps the one column.
  // The customer: the search box until one is picked, then one block with the name (× to
  // change), the site and the site contact.
  const customerField = (
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
          locationId={draft.location_id}
          locationName={job?.location_name ?? null}
          onLocation={(v) => set("location_id", v)}
          onChangeCustomer={() => {
            setChangingCustomer(true);
            setDraft((d) => ({ ...d, customer: null, hit: null, contact_id: "", location_id: "" }));
          }}
          onPickSite={(site, accountName) =>
            setDraft((d) => ({
              ...d,
              // Another property: its own sites (or none).
              location_id: d.customer?.site_id === site.id ? d.location_id : "",
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
                contact_id: hit && job?.account_id === hit.account_id ? (job.contact_id ?? "") : "",
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
              Not linked to a customer profile: “{job.customer_name}”. Pick or add one to link it.
            </p>
          )}
        </>
      )}
    </div>
  );
  // Owner, Sep 28: log each call / text / email / visit so the office sees the customer has been
  // reached (and the ticket leaves the untouched list).
  const customerContact = job && (
    // Owner, Sep 28: log each call / text / email / visit so the office sees the
    // customer has been reached (and the ticket leaves the untouched list).
    <section className="space-y-2 rounded-lg border p-3 text-sm" aria-label="Customer contact">
      <p className="flex items-center gap-1.5 font-medium">
        <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Customer contact
      </p>
      <LogContactButtons kind="ticket" itemId={job.id} />
      <LatestContact kind="ticket" itemId={job.id} />
    </section>
  );
  // Description, then PO # and Job #.
  const descriptionAndNumbers = (
    <>
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
    </>
  );
  // Type, date and (office) labor rate, then the technician and crew. The Board keeps the week
  // grid; here the select and the date set them (owner, Oct 1).
  const whatAndWhen = (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="space-y-1">
          <Label htmlFor="ticket-date">Date</Label>
          {dateInput}
        </div>
        <div className="space-y-1">
          <Label htmlFor="ticket-arrival">Arrival</Label>
          <Select
            value={draft.arrival_window || ARRIVAL_ANY}
            disabled={ro || dateLocked}
            onValueChange={(v) => set("arrival_window", v === ARRIVAL_ANY ? "" : v)}
          >
            <SelectTrigger id="ticket-arrival" title="Optional: when on that day">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ARRIVAL_ANY}>Any time</SelectItem>
              {ARRIVAL_WINDOWS.map((w) => (
                <SelectItem key={w} value={w}>
                  {ARRIVAL_LABELS[w]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {manager && (
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
      </div>
      {manager ? (
        <div className="space-y-2 sm:max-w-[460px]">
          <div className="flex items-end justify-between gap-2">
            <Label htmlFor="ticket-tech">
              Technician{crew && crew.others.length > 0 ? "s" : ""}
            </Label>
            {showRate && <span className="mr-11 w-28 text-xs text-muted-foreground">$ / hour</span>}
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
        // Anyone but a manager reads who is on the ticket (owner, Oct 1: the manager dispatches).
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">Technician</p>
            <p className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
              {/* The ticket's own technician, not the draft's: the draft is built once when the
                page opens, and a claim (here or on Work Overview) changes the ticket under it
                (owner, Oct 8: "it just says unassigned and you"). */}
              {assignedId
                ? (techOptions.find((t) => t.id === assignedId)?.name ??
                  job?.technician_name ??
                  "Former assignee")
                : "Unassigned"}
              {/* Owner, Oct 8: "nothing to show its mine now" — say so, and offer Claim here
                (the non-manager's view) when nobody has it yet. */}
              {job && job.technician_id === profile?.id && <Badge variant="secondary">You</Badge>}
              {job && !job.technician_id && !manager && canClaim(profile) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={claimMut.isPending}
                  onClick={() => claimMut.mutate(job.id)}
                >
                  Claim
                </Button>
              )}
            </p>
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
            <p className="text-xs text-muted-foreground">
              {job?.technician_id === profile?.id
                ? "Change it on the close-out."
                : "A manager dispatches the ticket."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
  // CenterPoint numbers: folded away unless the ticket carries one.
  const centerPointNumbers = (
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
  );
  // Notes: two rows to start, growing as they are typed (owner, Oct 1).
  const notesField = (
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
  );

  // The office on a saved ticket (owner, Oct 1): on xl and up the page is two panes, the form
  // on the left and the folding sections in a column on the right. A technician, and a new
  // ticket (no sections yet), keep one column.
  const twoPane = officeOrAdmin && !!job;
  // Owner, Oct 6: a toggle by Delete puts the sections below the form instead (remembered).
  const stacked = twoPane && layout === "stacked";

  const ticketForm = (
    <form
      className={`${isTech ? "max-w-3xl" : twoPane ? "max-w-5xl xl:max-w-none" : "max-w-5xl"} space-y-5`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {isTech ? (
        // A technician: one column, customer → description → PO # → type and date →
        // technician and crew → CenterPoint (folded) → notes.
        <>
          {customerField}
          {customerContact}
          {descriptionAndNumbers}
          {whatAndWhen}
          {centerPointNumbers}
          {notesField}
        </>
      ) : (
        // The office (owner, Oct 1): who and where on the left, what and when on the right,
        // stacking to one column under md; the rest full width below.
        <>
          <div className="grid gap-5 md:grid-cols-2 md:gap-x-8">
            <div className="min-w-0">{customerField}</div>
            <div className="min-w-0">{whatAndWhen}</div>
          </div>
          {customerContact}
          {descriptionAndNumbers}
          {notesField}
          {centerPointNumbers}
        </>
      )}

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
  );

  // Owner, Sep 28: log material here, on the ticket, never on the Inventory page.
  // Open for a technician on an Open / Scheduled ticket (they log here), else folded. Open for a
  // manager reviewing a Done / Authorized ticket (owner, Oct 5, follow-up 6), remembered apart.
  const review = manager && (jobStage === "done" || jobStage === "authorized");
  const materials =
    job &&
    (can("service") || can("inventory") || can("estimate") ? (
      <MaterialsSection
        jobId={job.id}
        collapsible
        defaultOpen={review || (isTech && (jobStage === "open" || jobStage === "scheduled"))}
        storageKey={review ? "materials-review" : undefined}
      />
    ) : (
      <MaterialsUsed jobId={job.id} canLog={false} />
    ));

  return (
    // Stacked (owner, Oct 6): the whole ticket is one centred column.
    <div className={stacked ? "mx-auto max-w-5xl space-y-6" : "space-y-6"}>
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
              {showCloseOut && (
                <Button asChild>
                  <Link to="/service" search={{ id: job.id, closeout: 1 }}>
                    <ClipboardCheck className="mr-1 h-4 w-4" /> Open ticket
                  </Link>
                </Button>
              )}
              <Select
                value={asStage(job.stage)}
                disabled={ro || lockedStage || stageMut.isPending}
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
              {manager && repeatable && (
                <Button asChild variant="outline">
                  <Link
                    to="/service"
                    search={{ new: 1, from: job.id }}
                    title={
                      job.site_id ? "New ticket for this property" : "New ticket for this customer"
                    }
                  >
                    <CopyPlus className="mr-1 h-4 w-4" />
                    Repeat
                  </Link>
                </Button>
              )}
              {manager && (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              )}
              {twoPane && (
                // Only where the two layouts differ (xl and up; narrower screens always stack).
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden xl:inline-flex"
                  aria-pressed={stacked}
                  aria-label={stacked ? "Sections beside the form" : "Sections below the form"}
                  title={stacked ? "Sections beside the form" : "Sections below the form"}
                  onClick={() => setLayout(stacked ? "side" : "stacked")}
                >
                  {stacked ? <Columns2 className="h-4 w-4" /> : <Rows2 className="h-4 w-4" />}
                </Button>
              )}
            </div>
          )}
        </div>
        {job && opened && (
          <p
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
            data-line="opened"
          >
            {opened}
            <OverdueBadge
              days={ticketOverdueDays(
                { stage: asStage(job.stage), scheduled_date: job.scheduled_date },
                localYmd(new Date()),
              )}
              what="Was due"
            />
          </p>
        )}
        {job?.from_opportunity_id && <FromOpportunityNote id={job.from_opportunity_id} />}
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
        {job && <StageStrip cells={stageCells} label="Stages" tones={STAGE_DOTS} />}
      </div>

      {ro && (
        <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <Lock className="h-4 w-4 shrink-0" />
          {officeStage && jobStage
            ? `The office has marked this ticket ${STAGE_LABELS[jobStage]}. You can read it; ask the office if something needs changing.`
            : `This ticket is assigned to ${job?.technician_name ?? "someone else"}. You can read it; only the assigned technician, the office or an admin can change it.`}
        </p>
      )}

      {twoPane && job ? (
        // Owner, Oct 1 ("the menus that open like aerial, materials, repairs … would go on the
        // right"): on xl and up, the form (left, ~60%) and the folding sections (right, ~40%,
        // at least 380 px; its top stays in view while the form scrolls, and it scrolls with
        // the page). Below xl they stack, the form first. Each section keeps its one-line
        // summary and remembered open state; Close out stays a header button.
        // Owner, Oct 6: or the same sections below the form ("stacked", the toggle by Delete).
        <div className={stacked ? STACKED_PANES : SIDE_PANES}>
          <div className="min-w-0">{ticketForm}</div>
          <aside className={stacked ? STACKED_ASIDE : SIDE_ASIDE} aria-label="Ticket sections">
            <AerialSection job={job} canEdit={canEdit} />
            <InspectionSection job={job} canEdit={canEdit} officeOrAdmin={officeOrAdmin} />
            <TicketRepairs jobId={job.id} ticketNumber={job.number} canEdit={canEdit} />
            {materials}
            {/* Owner (Oct 1): purchase orders sit under Materials — material bought for the job. */}
            <PurchaseOrdersSection jobId={job.id} />
            <TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} repairs={false} />
            <InvoiceBlock job={job} />
          </aside>
        </div>
      ) : (
        <>
          {ticketForm}
          {job && (
            // A technician (one column). Owner, Sep 28 ("so much crap on it"): the sections below
            // the form fold away with a one-line summary each; the open state is remembered.
            <div className="space-y-4">
              <TicketExtras job={job} canEdit={canEdit} />
              {materials}
              <PurchaseOrdersSection jobId={job.id} />
              <TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} />
            </div>
          )}
        </>
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
  /** The site inside the property; "" = none. */
  locationId: string;
  /** The saved site's name, for a site since removed from the property. */
  locationName: string | null;
  onLocation: (id: string) => void;
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
          Property
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
        <CountyCodeLine id={site?.county_code_id} className="text-xs" />
        {/* M5 (owner, Oct 5): the site's roof warranty while in force, as CenterPoint shows. */}
        <WarrantyBadges siteId={site?.id} />
        <PropertySiteSelect
          id="ticket-property-site"
          propertyId={props.siteId}
          value={props.locationId}
          savedName={props.locationName}
          disabled={props.disabled}
          onChange={props.onLocation}
        />
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

/**
 * "From opportunity: <title>" under "Opened …" on a ticket started from an opportunity (owner,
 * Oct 2), linking to it. Someone who cannot read the opportunity (its RLS) sees the line without
 * the title.
 */
function FromOpportunityNote({ id }: { id: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getOpportunity);
  const q = useQuery({
    queryKey: ["opportunity", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !!session,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return (
    <p className="flex items-center gap-1.5 text-sm" data-line="from-opportunity">
      <Target className="h-4 w-4 text-muted-foreground" />
      {q.data ? (
        <Link to="/opportunities" search={{ id }} className="underline underline-offset-2">
          {fromOpportunityLabel(q.data.title)}
        </Link>
      ) : (
        <span className="text-muted-foreground">From an opportunity</span>
      )}
    </p>
  );
}
