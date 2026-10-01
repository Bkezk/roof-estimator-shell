/**
 * Opportunities (docs/service-module-design.md §11): a potential new customer, or new work for
 * one, assigned to a user with an expected close date. Without an id the page lists them
 * grouped by status (Open → No response) like the Tickets page; `?new=1` opens a blank one and
 * `?id=<uuid>` an existing one. Saving (or a status change) syncs the follow-up timer on the
 * server; its state shows with Snooze / Close beside the form (a right-hand column on xl, below
 * the form otherwise), with the contact log. Won, Lost and No response stop the reminders.
 *
 * Owner, Oct 1: the status lives in the header only (a new one starts Open); the assignee is
 * required; a customer is optional, but once set the opportunity names its site
 * (lib/opportunity-form.ts); the lead source picks from a maintained list (Settings › General ›
 * Lead sources, type-to-add); "Start a bid" opens /estimate prefilled at any status.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Loader2,
  Phone,
  Plus,
  Save,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { OPPORTUNITY_DATE_REQUIRED } from "@/lib/ticket-date";
import {
  assigneeProblem,
  autoSiteId,
  bidPrefillFromOpportunity,
  opportunitySiteProblem,
} from "@/lib/opportunity-form";
import { getAccount } from "@/lib/crm.functions";
import type { StatusFilter } from "@/lib/opportunities-search";
import { localYmd } from "@/lib/tasks";
import { isOpenOppStatus, isOverdueOpp, OPP_ALL_OPEN } from "@/lib/work-counts";
import {
  deleteOpportunity,
  getOpportunity,
  listOpportunities,
  OPP_CLOSING,
  OPP_STATUS_LABELS,
  OPP_STATUSES,
  saveOpportunity,
  setOpportunityStatus,
  type OppStatus,
  type OpportunityInput,
  type OpportunityWithNames,
} from "@/lib/opportunities.functions";
import { getCrmSettings, listFollowups } from "@/lib/followups.functions";
import { listTechnicians } from "@/lib/auth.functions";
import { AccountPicker, type AccountPickerValue } from "@/components/crm/account-picker";
import { LeadSourcePicker } from "@/components/crm/lead-source-picker";
import { SiteSelect } from "@/components/crm/site-select";
import { CloseFollowupDialog, SnoozeMenu } from "@/components/followups-page";
import { followupsKey, useFollowupActions, whenDay, whenTime } from "@/components/followups-shared";
import {
  ContactLogList,
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
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AutoTextarea } from "@/components/ui/auto-textarea";

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
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const asStatus = (s: string): OppStatus =>
  (OPP_STATUSES as readonly string[]).includes(s) ? (s as OppStatus) : "open";
const isClosing = (s: OppStatus) => OPP_CLOSING.includes(s);

const STATUS_BADGE: Record<OppStatus, "default" | "secondary" | "outline"> = {
  open: "default",
  contacted: "secondary",
  quoted: "secondary",
  won: "outline",
  lost: "outline",
  no_response: "outline",
};

export function OpportunitiesPage({
  id,
  isNew,
  status,
  overdue,
}: {
  id?: string | undefined;
  isNew?: boolean;
  /** The list: preset the status chip (`?status=`; "allopen" = every non-closing status). */
  status?: Exclude<StatusFilter, "all"> | undefined;
  /** The list: preset the Overdue filter (`?overdue=1`, the Customers page counts strip). */
  overdue?: boolean | undefined;
}) {
  if (id) return <OppLoader id={id} />;
  if (isNew) return <OppEditor opp={null} />;
  // Keyed on the preset so following another counts-strip link re-applies it.
  return (
    <OppList
      key={`${status ?? ""}|${overdue ? 1 : 0}`}
      presetStatus={status}
      presetOverdue={!!overdue}
    />
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

/** Status groups the user has collapsed, remembered across reloads (per browser). */
const COLLAPSED_KEY = "bid-o-matic:opps-collapsed";
const readCollapsed = (): OppStatus[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(raw) ? OPP_STATUSES.filter((s) => raw.includes(s)) : [];
  } catch {
    return [];
  }
};
const writeCollapsed = (statuses: OppStatus[]) => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(statuses));
  } catch {
    // Storage unavailable (private mode, blocked site data) — collapse still works this visit.
  }
};

function OppList({
  presetStatus,
  presetOverdue,
}: {
  presetStatus?: Exclude<StatusFilter, "all"> | undefined;
  presetOverdue: boolean;
}) {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listOpportunities);
  const list = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => listFn(),
    enabled: !!session,
  });

  // Assigned opportunities with no contact logged and still Open (query key ["untouched"]).
  const untouchedFn = useServerFn(listUntouched);
  const untouchedQ = useQuery({
    queryKey: ["untouched"],
    queryFn: () => untouchedFn(),
    enabled: !!session,
  });
  const untouched = useMemo(() => {
    const m = new Map<string, UntouchedRow>();
    for (const r of untouchedQ.data ?? [])
      if (r.kind === "opportunity") m.set(untouchedKey(r.kind, r.item_id), r);
    return m;
  }, [untouchedQ.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(presetStatus ?? "all");
  // Overdue: open opportunities past their expected close (lib/work-counts.ts isOverdueOpp),
  // preset by ?overdue=1 from the Customers page counts strip; cleared from its chip.
  const [overdueOnly, setOverdueOnly] = useState(presetOverdue);
  const today = localYmd(new Date());
  const [mine, setMine] = useState(false);
  const [collapsed, setCollapsed] = useState<OppStatus[]>(readCollapsed);
  const toggleGroup = (status: OppStatus) =>
    setCollapsed((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status];
      writeCollapsed(next);
      return next;
    });

  const opps = list.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = opps.filter((o) => {
    if (mine && o.assignee_id !== profile?.id) return false;
    if (statusFilter === OPP_ALL_OPEN) {
      if (!isOpenOppStatus(asStatus(o.status))) return false;
    } else if (statusFilter !== "all" && asStatus(o.status) !== statusFilter) return false;
    if (overdueOnly && !isOverdueOpp({ ...o, status: asStatus(o.status) }, today)) return false;
    if (q) {
      const hay = [
        o.title,
        o.account_name,
        o.site_name,
        o.assignee_name,
        o.lead_source,
        o.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Grouped Open → No response. Open groups read soonest expected close first; the closed ones
  // keep the server's newest-update-first order. Empty groups are left out.
  const groups = OPP_STATUSES.map((status) => {
    const rows = filtered.filter((o) => asStatus(o.status) === status);
    if (!isClosing(status))
      rows.sort((a, b) => (a.expected_close ?? "9999").localeCompare(b.expected_close ?? "9999"));
    return { status, rows };
  }).filter((g) => g.rows.length > 0);
  const anyFilter = q !== "" || statusFilter !== "all" || mine || overdueOnly;
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setOverdueOnly(false);
    setMine(false);
  };
  const newOpp = () => void navigate({ to: "/opportunities", search: { new: 1 } });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Target className="h-6 w-6" /> Opportunities
          </h1>
          <p className="text-sm text-muted-foreground">
            Potential new customers and new work. The assignee is reminded until it is Won, Lost or
            No response.
          </p>
        </div>
        <Button size="lg" className="text-base font-semibold" onClick={newOpp}>
          <Plus className="mr-2 h-5 w-5" /> New opportunity
        </Button>
      </div>

      <NeedsActionStrip kinds={["opportunity"]} />

      {list.error ? (
        <p className="text-sm text-destructive">
          Could not load opportunities ({errText(list.error)}). Try refreshing, or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading opportunities…
        </p>
      ) : (
        <>
          {opps.length > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Search
                <Input
                  type="search"
                  placeholder="Title, customer, assignee, lead source…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-background"
                />
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                  All statuses
                </Chip>
                <Chip
                  active={statusFilter === OPP_ALL_OPEN}
                  onClick={() =>
                    setStatusFilter(statusFilter === OPP_ALL_OPEN ? "all" : OPP_ALL_OPEN)
                  }
                >
                  All open
                </Chip>
                {OPP_STATUSES.map((s) => (
                  <Chip
                    key={s}
                    active={statusFilter === s}
                    onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                  >
                    {OPP_STATUS_LABELS[s]}
                  </Chip>
                ))}
                {overdueOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 rounded-full px-3 text-xs"
                    title="Only open opportunities past their expected close. Click to show all."
                    onClick={() => setOverdueOnly(false)}
                  >
                    Overdue <X className="ml-1 h-3 w-3" aria-hidden />
                    <span className="sr-only">(clear)</span>
                  </Button>
                )}
                <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                <Chip active={mine} onClick={() => setMine(!mine)}>
                  Mine
                </Chip>
                {anyFilter && (
                  <Button variant="ghost" size="sm" className="h-7" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {filtered.length} of {opps.length} opportunit{opps.length === 1 ? "y" : "ies"}
                </span>
              </div>
            </div>
          )}

          {opps.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">No opportunities yet.</p>
              <Button variant="outline" className="mt-4" onClick={newOpp}>
                Add the first opportunity
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">
                No opportunities match these filters{mine ? " (showing only yours)" : ""}.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-8">
              {groups.map(({ status, rows }) => {
                const open = !collapsed.includes(status);
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                  <section key={status} aria-label={`${OPP_STATUS_LABELS[status]} opportunities`}>
                    <h2 className={`border-b border-border pb-1.5 ${open ? "mb-3" : ""}`}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={open}
                        aria-controls={`opp-group-${status}`}
                        title={open ? "Collapse this group" : "Expand this group"}
                        onClick={() => toggleGroup(status)}
                      >
                        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-semibold uppercase tracking-wide">
                          {OPP_STATUS_LABELS[status]}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {rows.length} opportunit{rows.length === 1 ? "y" : "ies"}
                        </span>
                      </button>
                    </h2>
                    {open && (
                      <div id={`opp-group-${status}`} className="grid gap-3">
                        {rows.map((o) => (
                          <OppListRow
                            key={o.id}
                            row={o}
                            untouched={untouched.get(untouchedKey("opportunity", o.id))}
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
    </div>
  );
}

function OppListRow({
  row: o,
  untouched,
}: {
  row: OpportunityWithNames;
  /** Assigned with no contact logged and still Open (listUntouched). */
  untouched?: UntouchedRow | undefined;
}) {
  const navigate = useNavigate();
  const status = asStatus(o.status);
  const meta = [
    o.site_name ? `Site: ${o.site_name}` : null,
    o.assignee_name ?? "Unassigned",
    o.expected_close ? `Expected close ${day(o.expected_close)}` : "No close date",
    o.est_value != null ? money(o.est_value) : null,
    o.lead_source,
  ].filter(Boolean);
  // Owner, Sep 28: the whole card opens the opportunity, as on Bids (no Open button).
  const open = () => void navigate({ to: "/opportunities", search: { id: o.id } });
  return (
    <div
      role="link"
      tabIndex={0}
      title="Open this opportunity"
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
          <span className="font-medium">{o.title}</span>
          <Badge variant={STATUS_BADGE[status]} className="px-1.5 py-0 text-[11px]">
            {OPP_STATUS_LABELS[status]}
          </Badge>
          {untouched && (
            <UntouchedBadge assignedAt={untouched.assigned_at} limitDays={untouched.limit_days} />
          )}
        </div>
        {(o.account_name || o.description) && (
          <p className="text-sm">
            {o.account_name && (
              <span className="text-muted-foreground">
                {o.account_name}
                {o.description ? " · " : ""}
              </span>
            )}
            {o.description}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {meta.join(" · ")} · Updated {when(o.updated_at)}
          {o.updated_by_name ? ` by ${o.updated_by_name}` : ""}
        </p>
      </div>
    </div>
  );
}

function OppLoader({ id }: { id: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getOpportunity);
  const opp = useQuery({
    queryKey: ["opportunity", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !!session,
  });
  if (opp.error)
    return (
      <div className="space-y-3">
        <BackToList />
        <p className="text-sm text-destructive">
          Could not open the opportunity: {errText(opp.error)}
        </p>
      </div>
    );
  if (!opp.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the opportunity…
      </p>
    );
  return <OppEditor key={opp.data.id} opp={opp.data} />;
}

function BackToList() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/opportunities">
        <ArrowLeft className="mr-1 h-4 w-4" /> Opportunities
      </Link>
    </Button>
  );
}

/** The picked customer: the site (null until picked) and the hit's site count (a fallback until
 * the customer's detail loads). */
interface OppCustomer extends AccountPickerValue {
  site_count?: number;
}

interface Draft {
  title: string;
  customer: OppCustomer | null;
  /** "" = not picked yet (required, no default). */
  assignee_id: string;
  expected_close: string;
  /** A new opportunity's status (the header select; Open to start). */
  status: OppStatus;
  lead_source: string;
  /** 0 = blank (no estimate). */
  est_value: number;
  description: string;
  notes: string;
}

const draftFrom = (o: OpportunityWithNames | null): Draft =>
  o
    ? {
        title: o.title,
        customer: o.account_id
          ? {
              account_id: o.account_id,
              site_id: o.site_id,
              label: o.account_name ?? "Customer",
            }
          : null,
        assignee_id: o.assignee_id ?? "",
        expected_close: o.expected_close ?? "",
        status: asStatus(o.status),
        lead_source: o.lead_source ?? "",
        est_value: o.est_value ?? 0,
        description: o.description ?? "",
        notes: o.notes ?? "",
      }
    : {
        title: "",
        customer: null,
        // Owner, Oct 1: no default — the office creates opportunities for others.
        assignee_id: "",
        expected_close: "",
        status: "open",
        lead_source: "",
        est_value: 0,
        description: "",
        notes: "",
      };
const draftKey = (d: Draft) =>
  JSON.stringify({
    ...d,
    customer: d.customer ? [d.customer.account_id, d.customer.site_id] : null,
    status: null,
  });

function OppEditor({ opp }: { opp: OpportunityWithNames | null }) {
  const { session, profile, can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveOpportunity);
  const statusFn = useServerFn(setOpportunityStatus);
  const deleteFn = useServerFn(deleteOpportunity);
  const techFn = useServerFn(listTechnicians);
  const settingsFn = useServerFn(getCrmSettings);
  const accountFn = useServerFn(getAccount);

  const [draft, setDraft] = useState<Draft>(() => draftFrom(opp));
  const [savedKey, setSavedKey] = useState(() => draftKey(draft));
  const dirty = draftKey(draft) !== savedKey;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The × on the customer block: the search box comes back, focused.
  const [changingCustomer, setChangingCustomer] = useState(false);
  const status = opp ? asStatus(opp.status) : draft.status;

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
    // Keep the current assignee listed even if they are no longer on the roster.
    if (opp?.assignee_id && !all.some((t) => t.id === opp.assignee_id))
      all.unshift({
        id: opp.assignee_id,
        name: opp.assignee_name ?? "Former assignee",
        technician: false,
      });
    return all;
  }, [techs.data, opp?.assignee_id, opp?.assignee_name]);
  const settings = useQuery({
    queryKey: ["crm-settings"],
    queryFn: () => settingsFn(),
    enabled: !!session && !opp,
    staleTime: 5 * 60_000,
  });

  // The customer's sites (the same query the site box reads): with a customer, the opportunity
  // names the site — one is picked without asking, several need a pick (owner, Oct 1).
  const accountId = draft.customer?.account_id ?? null;
  const accountQ = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => accountFn({ data: { id: accountId! } }),
    enabled: !!session && !!accountId,
  });
  const liveSites = accountQ.data?.account.id === accountId ? accountQ.data.sites : null;
  const siteCount = liveSites ? liveSites.length : (draft.customer?.site_count ?? 0);
  const siteId = draft.customer
    ? (draft.customer.site_id ?? (liveSites ? autoSiteId(liveSites) : null))
    : null;
  const siteMessage = opportunitySiteProblem({ account_id: accountId, site_id: siteId, siteCount });
  const assigneeMessage = assigneeProblem({ id: opp?.id, assignee_id: draft.assignee_id || null });

  const invalidate = (id: string) => {
    void qc.invalidateQueries({ queryKey: ["opportunities"] });
    void qc.invalidateQueries({ queryKey: ["opportunity", id] });
    void qc.invalidateQueries({ queryKey: ["followups"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const input: OpportunityInput = {
        // A new one carries the header's status (Open to start).
        ...(opp ? { id: opp.id } : { status: draft.status }),
        title: draft.title.trim(),
        account_id: draft.customer?.account_id ?? null,
        site_id: siteId,
        assignee_id: draft.assignee_id || null,
        expected_close: draft.expected_close || null,
        lead_source: draft.lead_source,
        est_value: draft.est_value > 0 ? draft.est_value : null,
        description: draft.description,
        notes: draft.notes,
        // Keep a bid linked elsewhere (no field for it here yet).
        bid_id: opp?.bid_id ?? null,
      };
      return saveFn({ data: input });
    },
    onSuccess: (row) => {
      invalidate(row.id);
      if (row.account_id) void qc.invalidateQueries({ queryKey: ["account", row.account_id] });
      qc.setQueryData(["opportunity", row.id], row);
      if (opp) {
        setSavedKey(draftKey(draft));
        toast.success("Opportunity saved");
      } else {
        toast.success("Opportunity created");
        void navigate({ to: "/opportunities", search: { id: row.id }, replace: true });
      }
    },
    onError: (e) => toast.error(`Could not save the opportunity: ${errText(e)}`),
  });

  const statusMut = useMutation({
    mutationFn: (s: OppStatus) => statusFn({ data: { id: opp!.id, status: s } }),
    onSuccess: (_r, s) => {
      toast.success(
        `Status: ${OPP_STATUS_LABELS[s]}${isClosing(s) ? " — follow-up reminders stopped" : ""}`,
      );
      invalidate(opp!.id);
    },
    onError: (e) => toast.error(`Could not change the status: ${errText(e)}`),
  });

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: opp!.id } }),
    onSuccess: () => {
      toast.success("Opportunity deleted");
      void qc.invalidateQueries({ queryKey: ["opportunities"] });
      void qc.invalidateQueries({ queryKey: ["followups"] });
      void navigate({ to: "/opportunities" });
    },
    onError: (e) => toast.error(`Could not delete the opportunity: ${errText(e)}`),
  });

  const submit = () => {
    if (save.isPending) return;
    if (!draft.title.trim()) {
      toast.error("Give the opportunity a title first");
      return;
    }
    if (assigneeMessage || siteMessage) {
      toast.error(assigneeMessage ?? siteMessage);
      return;
    }
    save.mutate();
  };

  const assigneeItems = (list: typeof techOptions) =>
    list.map((t) => (
      <SelectItem key={t.id} value={t.id}>
        {t.name}
        {t.id === profile?.id ? " (me)" : ""}
      </SelectItem>
    ));

  // Owner, Oct 1: the status lives in the header only — a new opportunity's select sets the
  // status it is created with (Open to start); a saved one's changes it at once.
  const statusSelect = (
    <Select
      value={status}
      disabled={statusMut.isPending}
      onValueChange={(v) =>
        opp ? statusMut.mutate(v as OppStatus) : set("status", v as OppStatus)
      }
    >
      <SelectTrigger className="w-[150px]" aria-label="Status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPP_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {OPP_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // The customer: the search box until one is picked, then one block with the name (× to
  // change) and the site, as on a ticket. Optional (a prospect may not be a customer yet).
  const customerField = (
    <div className="space-y-1">
      <Label htmlFor={draft.customer ? undefined : "opp-customer"}>Customer</Label>
      {draft.customer ? (
        <OppCustomerBlock
          accountId={draft.customer.account_id}
          name={accountQ.data?.account.name ?? draft.customer.label}
          siteId={siteId}
          siteMessage={siteMessage}
          onChangeCustomer={() => {
            setChangingCustomer(true);
            set("customer", null);
          }}
          onPickSite={(id) =>
            setDraft((d) => (d.customer ? { ...d, customer: { ...d.customer, site_id: id } } : d))
          }
        />
      ) : (
        <AccountPicker
          id="opp-customer"
          value={null}
          autoFocus={changingCustomer}
          placeholder="Search or add a customer (optional)…"
          onChange={(hit) =>
            set(
              "customer",
              hit
                ? {
                    account_id: hit.account_id,
                    // A customer with one site comes with it (lib/account-search.ts).
                    site_id: hit.site_id,
                    label: hit.account_name,
                    site_count: hit.site_count,
                  }
                : null,
            )
          }
        />
      )}
    </div>
  );

  // Owner, Oct 1 ("the tighter layout"): who / where / what on the left, the four short fields
  // on the right (one row of four when the column is wide enough, else two by two), Notes and
  // Create / Save below.
  const oppForm = (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-5 md:grid-cols-2 md:gap-x-8">
        <div className="min-w-0 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="opp-title">Title</Label>
            <Input
              id="opp-title"
              value={draft.title}
              autoFocus={!opp}
              maxLength={200}
              placeholder="e.g. Reroof — Yellow Creek Elementary gym"
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          {customerField}
          <div className="space-y-1">
            <Label htmlFor="opp-description">Description</Label>
            <AutoTextarea
              id="opp-description"
              rows={2}
              value={draft.description}
              maxLength={2000}
              placeholder="What the job is"
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
        </div>

        <div className="@container min-w-0">
          <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-4" data-row="opp-four-fields">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="opp-assignee">Assignee</Label>
              <Select value={draft.assignee_id} onValueChange={(v) => set("assignee_id", v)}>
                <SelectTrigger
                  id="opp-assignee"
                  aria-invalid={!!assigneeMessage || undefined}
                  className={assigneeMessage ? "border-destructive" : ""}
                >
                  <SelectValue placeholder="Pick someone…" />
                </SelectTrigger>
                <SelectContent>
                  {techOptions.some((t) => !t.technician) && (
                    <SelectGroup>
                      <SelectLabel>Office</SelectLabel>
                      {assigneeItems(techOptions.filter((t) => !t.technician))}
                    </SelectGroup>
                  )}
                  {techOptions.some((t) => t.technician) && (
                    <SelectGroup>
                      <SelectLabel>Technicians</SelectLabel>
                      {assigneeItems(techOptions.filter((t) => t.technician))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {techs.error && (
                <p className="text-xs text-destructive">
                  Could not load the users: {errText(techs.error)}
                </p>
              )}
              {assigneeMessage && <p className="text-xs text-destructive">{assigneeMessage}</p>}
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="opp-close">Expected close</Label>
              <Input
                id="opp-close"
                type="date"
                value={draft.expected_close}
                onChange={(e) => set("expected_close", e.target.value)}
              />
              {opp && !draft.expected_close && (
                <p className="text-xs text-destructive">{OPPORTUNITY_DATE_REQUIRED}</p>
              )}
              {!opp && (
                <p className="text-xs text-muted-foreground">
                  Blank = the admin default
                  {settings.data ? ` (${settings.data.opportunity_close_days} days)` : ""}.
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="opp-source">Lead source</Label>
              <LeadSourcePicker
                id="opp-source"
                value={draft.lead_source}
                onChange={(v) => set("lead_source", v)}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="opp-value">Est. value ($)</Label>
              <div id="opp-value">
                <NumberField
                  value={draft.est_value}
                  min={0}
                  step="any"
                  inputMode="decimal"
                  onChange={(v) => set("est_value", v)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="opp-notes">Notes</Label>
        <AutoTextarea
          id="opp-notes"
          rows={2}
          value={draft.notes}
          maxLength={10000}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="lg"
          disabled={
            save.isPending ||
            (!!opp && !dirty) ||
            (!!opp && !draft.expected_close) ||
            !!assigneeMessage ||
            !!siteMessage
          }
        >
          {save.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {opp ? "Save" : "Create opportunity"}
        </Button>
        {opp && dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        {!opp && draft.assignee_id && (
          <span className="text-xs text-muted-foreground">
            Creating it starts the assignee&apos;s follow-up reminders.
          </span>
        )}
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackToList />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-bold tracking-tight">
            <Target className="h-6 w-6 shrink-0" />
            <span className="truncate">{opp ? opp.title : "New opportunity"}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {statusSelect}
            {opp &&
              // Owner, Oct 1: at every status. A linked bid shows instead (opens it).
              (opp.bid_id ? (
                <Button asChild variant="outline">
                  <Link to="/estimate" search={{ bid: opp.bid_id }} title="Open the linked bid">
                    <FileText className="mr-1 h-4 w-4" /> Bid: {opp.bid_name ?? "open it"}
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link
                    to="/estimate"
                    search={bidPrefillFromOpportunity(opp)}
                    title="A new bid for this opportunity's customer and site"
                  >
                    <FilePlus2 className="mr-1 h-4 w-4" /> Start a bid
                  </Link>
                </Button>
              ))}
            {opp && can("customers") && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        </div>
        {opp && (
          <p className="text-xs text-muted-foreground">
            {[opp.account_name, opp.site_name ? `Site: ${opp.site_name}` : null]
              .filter(Boolean)
              .map((s) => `${s} · `)
              .join("")}
            Updated {when(opp.updated_at)}
            {opp.updated_by_name ? ` by ${opp.updated_by_name}` : ""}
          </p>
        )}
      </div>

      {opp ? (
        // Owner, Oct 1 (as the ticket): on xl and up, the form on the left and a column on the
        // right with the follow-up and the contact log (its top stays in view while the form
        // scrolls). Below xl they stack, the form first.
        <div className="space-y-6 xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)] xl:items-start xl:gap-8 xl:space-y-0">
          <div className="min-w-0">{oppForm}</div>
          <aside
            className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:min-w-[380px]"
            aria-label="Follow-up and contact"
          >
            <FollowupStrip opp={opp} status={status} />
            {/* Owner, Sep 28: log each call / text / email / visit. The first one moves an Open
                opportunity to Contacted (server side); the buttons refetch this opportunity so
                the status select shows it. */}
            <section className="space-y-2 rounded-md border px-3 py-2 text-sm" aria-label="Contact">
              <p className="flex items-center gap-1.5 font-medium">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Contact
              </p>
              <LogContactButtons
                kind="opportunity"
                itemId={opp.id}
                onLogged={() => invalidate(opp.id)}
              />
              <ContactLogList kind="opportunity" itemId={opp.id} />
            </section>
          </aside>
        </div>
      ) : (
        oppForm
      )}

      {opp && (
        <AlertDialog
          open={confirmDelete}
          onOpenChange={(o) => {
            if (!remove.isPending) setConfirmDelete(o);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{opp.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The opportunity is removed from the list and its follow-up reminders stop.
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

/**
 * The picked customer as one block (as the ticket's): the name (opens the customer) with an ×
 * to change it, then the site box — required when the customer has several sites; one site
 * comes with the pick.
 */
function OppCustomerBlock(props: {
  accountId: string;
  name: string;
  siteId: string | null;
  /** Why the site still needs picking (lib/opportunity-form.ts), or null. */
  siteMessage: string | null;
  onChangeCustomer: () => void;
  onPickSite: (siteId: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/customers"
          search={{ id: props.accountId }}
          className="min-w-0 truncate text-base font-medium underline-offset-2 hover:underline"
          title="Open this customer"
        >
          {props.name || "Customer"}
        </Link>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          title="Change the customer"
          aria-label="Change the customer"
          onClick={props.onChangeCustomer}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-1">
        <label htmlFor="opp-site" className="text-xs font-medium">
          Site
        </label>
        <SiteSelect
          id="opp-site"
          accountId={props.accountId}
          value={props.siteId}
          required
          invalid={!!props.siteMessage}
          className="bg-background"
          onChange={(s) => {
            if (s) props.onPickSite(s.id);
          }}
        />
        {props.siteMessage && <p className="text-xs text-destructive">{props.siteMessage}</p>}
      </div>
    </div>
  );
}

/** The opportunity's open follow-up (if any) with Snooze / Close. */
function FollowupStrip({ opp, status }: { opp: OpportunityWithNames; status: OppStatus }) {
  const { session } = useAuth();
  const listFn = useServerFn(listFollowups);
  const followups = useQuery({
    queryKey: followupsKey(false),
    queryFn: () => listFn({ data: { include_closed: false } }),
    enabled: !!session,
  });
  const { snooze, close } = useFollowupActions();
  const [closing, setClosing] = useState(false);
  const f = (followups.data ?? []).find(
    (x) => x.kind === "opportunity" && x.item_id === opp.id && x.status === "open",
  );

  const box = "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm";
  if (followups.error)
    return (
      <p className={`${box} text-destructive`}>
        Could not load the follow-up: {errText(followups.error)}
      </p>
    );
  if (followups.isLoading)
    return (
      <p className={`${box} text-muted-foreground`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the follow-up…
      </p>
    );
  if (!f)
    return (
      <p className={`${box} text-muted-foreground`}>
        <BellRing className="h-4 w-4 shrink-0" />
        {isClosing(status)
          ? `No follow-up: ${OPP_STATUS_LABELS[status]} stops the reminders.`
          : !opp.assignee_id
            ? "No follow-up: assign someone to start the reminders."
            : "No open follow-up for this opportunity."}
      </p>
    );
  const overdue = new Date(f.due_at).getTime() < Date.now();
  return (
    <div className={box}>
      <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        Follow-up with <span className="font-medium">{f.assignee_name}</span>: next reminder{" "}
        {whenTime(f.next_remind_at)}
        <span className={overdue ? "text-destructive" : "text-muted-foreground"}>
          {" "}
          · due {whenDay(f.due_at)} · {f.reminders_sent} sent
        </span>
      </span>
      <SnoozeMenu
        disabled={snooze.isPending || close.isPending}
        onSnooze={(days) => snooze.mutate({ id: f.id, days })}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={snooze.isPending || close.isPending}
        onClick={() => setClosing(true)}
      >
        <CheckCircle2 className="mr-1 h-4 w-4" /> Close
      </Button>
      <CloseFollowupDialog
        target={closing ? { id: f.id, title: f.title } : null}
        pending={close.isPending}
        onCancel={() => setClosing(false)}
        onConfirm={(reason) =>
          close.mutate(
            { id: f.id, ...(reason ? { reason } : {}) },
            { onSuccess: () => setClosing(false) },
          )
        }
      />
    </div>
  );
}
