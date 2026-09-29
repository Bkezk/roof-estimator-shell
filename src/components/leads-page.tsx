/**
 * Construction leads (owner, Sep 28: "is there any way to get data on new builds before
 * they're built giving us time to submit a bid?"). Two public feeds, pulled nightly and when
 * this page loads (throttled to six hours on the server): every state-funded project out for bid
 * on the State of KY planroom, and Louisville Metro's large commercial building permits. A lead
 * can be watched, dismissed, or added to My prospects as a building. Nothing here touches bids.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Info, Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { isAdmin } from "@/lib/access";
import {
  addLeadToProspects,
  LEAD_SOURCES,
  leadCounts,
  listLeads,
  refreshLeadsIfDue,
  setLeadStatus,
  SOURCE_LABELS,
  type LeadRow,
  type LeadStatus,
} from "@/lib/leads.functions";
import { LeadCard } from "@/components/prospect/lead-card";
import { isClosedBid } from "@/components/prospect/lead-format";
import { LeadSettingsPanel } from "@/components/prospect/lead-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Source =
  "all" | "ky_planroom" | "louisville_permits" | "lynn_bids" | "bgky_bids" | "paducah_bids";
type StatusTab = "open" | "watching" | "added" | "dismissed";
const TABS: { value: StatusTab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "watching", label: "Watching" },
  { value: "added", label: "Added" },
  { value: "dismissed", label: "Dismissed" },
];

const ABOUT =
  "State planroom: every state-funded Kentucky project in its bid phase, with pre-bid and bid dates. " +
  "Lynn Imaging bids: every project Lynn prints plans for, statewide (housing authorities, cities, counties, districts, private owners), posted the day plans go out for bid. " +
  "Bowling Green and Paducah bids: those cities' own bid pages. " +
  "Louisville permit: new and addition commercial building permits from Louisville Metro, issued in the last few months. " +
  "The app checks them every 6 hours when this page is open, and nightly.";

/** The source failures a refresh appends to its note ("…; State planroom → 503"). */
function fetchProblem(note: string | null | undefined): string | null {
  if (!note) return null;
  const i = note.search(
    /; (State planroom|Louisville permits|Lynn Imaging bids|Bowling Green bids|Paducah bids) /,
  );
  if (i >= 0) return note.slice(i + 2);
  return /failed/i.test(note) ? note : null;
}

export function LeadsPage(props: { initialRoofOnly?: boolean | undefined }) {
  const { can, profile } = useAuth();
  const canWrite = can("prospect");
  const admin = isAdmin(profile);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const listFn = useServerFn(listLeads);
  const countsFn = useServerFn(leadCounts);
  const refreshFn = useServerFn(refreshLeadsIfDue);
  const statusFn = useServerFn(setLeadStatus);
  const addFn = useServerFn(addLeadToProspects);

  // Roof leads are the point: on by default (the notification link sets it too).
  const [roofOnly, setRoofOnly] = useState(props.initialRoofOnly ?? true);
  const [source, setSource] = useState<Source>("all");
  const [tab, setTab] = useState<StatusTab>("open");
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const filters = { roofOnly, source, status: tab };
  const leads = useQuery({
    queryKey: ["leads", filters],
    queryFn: () =>
      listFn({
        data: {
          roofOnly,
          status: tab,
          ...(source !== "all" ? { source } : {}),
        },
      }),
  });
  const counts = useQuery({ queryKey: ["lead-counts"], queryFn: () => countsFn() });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["leads"] });
    void qc.invalidateQueries({ queryKey: ["lead-counts"] });
  };

  const refresh = useMutation({
    mutationFn: (force: boolean) => refreshFn({ data: { force } }),
    onSuccess: (r, force) => {
      setRefreshError(r.error);
      if (r.error) toast.error(`Lead refresh: ${r.error}`);
      else if (force) toast.success(r.note ?? "Leads checked");
      if (r.ran || force) invalidate();
    },
    onError: (e) => {
      setRefreshError(errText(e));
      toast.error(`Lead refresh failed: ${errText(e)}`);
    },
  });
  // The lazy pass: a Prospecting user's visit pulls the feeds if the last pull is over six
  // hours old (the server throttles). Once per page load; silent unless it fails.
  const refreshStarted = useRef(false);
  useEffect(() => {
    if (!canWrite || refreshStarted.current) return;
    refreshStarted.current = true;
    refresh.mutate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, [canWrite]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: LeadStatus; note?: string | null }) =>
      statusFn({ data: v }),
    onMutate: (v) => setBusyId(v.id),
    onSuccess: (_row, v) => {
      if (v.note !== undefined) toast.success("Note saved");
      invalidate();
    },
    onError: (e) => toast.error(`Could not update the lead: ${errText(e)}`),
    onSettled: () => setBusyId(null),
  });
  const addToProspects = useMutation({
    mutationFn: (id: string) => addFn({ data: { id } }),
    onMutate: (id) => setBusyId(id),
    onSuccess: (r) => {
      invalidate();
      toast.success(r.existed ? "Already in My prospects" : "Added to My prospects");
      void navigate({ to: "/prospect", search: { building: r.building_id } });
    },
    onError: (e) => toast.error(`Could not add to prospects: ${errText(e)}`),
    onSettled: () => setBusyId(null),
  });

  const rows = useMemo(() => leads.data ?? [], [leads.data]);
  const closedCount = useMemo(() => rows.filter((l) => isClosedBid(l)).length, [rows]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((l: LeadRow) => {
      if (!showClosed && isClosedBid(l)) return false;
      if (!q) return true;
      return [l.title, l.agency, l.location, l.address, l.city, l.contractor]
        .filter(Boolean)
        .some((t) => t!.toLowerCase().includes(q));
    });
  }, [rows, search, showClosed]);

  const settings = counts.data?.settings;
  const problem = refreshError ?? fetchProblem(settings?.last_fetch_note);
  const neverPulled = !!counts.data && !settings?.last_fetch_at;
  const openCount = counts.data ? (roofOnly ? counts.data.open_roof : counts.data.open) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Projects out for bid across Kentucky and Louisville commercial permits — new roofs
            before they're built.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {refresh.isPending
              ? "Checking…"
              : settings?.last_fetch_at
                ? `Checked ${formatDistanceToNow(Date.parse(settings.last_fetch_at), { addSuffix: true })}`
                : counts.data
                  ? "Not checked yet"
                  : ""}
          </span>
          <span
            className="inline-flex h-7 w-7 cursor-help items-center justify-center text-muted-foreground"
            tabIndex={0}
            aria-label="Where leads come from"
            title={`${ABOUT}${settings?.last_fetch_note ? `\n\nLast check: ${settings.last_fetch_note}` : ""}`}
          >
            <Info className="h-3.5 w-3.5" />
          </span>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(true)}
              title="Pull the state planroom and Louisville permits now"
            >
              {refresh.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Refresh
            </Button>
          )}
          {admin && settings && (
            <Button
              size="icon"
              variant={settingsOpen ? "secondary" : "ghost"}
              className="h-8 w-8"
              aria-label="Lead settings"
              title="Lead settings: roof keywords and which Louisville permits count"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {problem && <p className="text-xs text-destructive">Last check had a problem: {problem}</p>}

      {admin && settings && settingsOpen && (
        <LeadSettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value === "open" && openCount != null && (
                  <span className="ml-1 text-xs text-muted-foreground">{openCount}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Switch id="leads-roof" checked={roofOnly} onCheckedChange={setRoofOnly} />
          <Label htmlFor="leads-roof" className="flex cursor-pointer items-center gap-1.5">
            Roof only
            {counts.data && (
              <Badge variant="destructive" className="px-1.5">
                Roof · {counts.data.open_roof}
              </Badge>
            )}
          </Label>
        </div>
        <Select value={source} onValueChange={(v) => setSource(v as Source)}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {LEAD_SOURCES.map((k) => (
              <SelectItem key={k} value={k}>
                {SOURCE_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Checkbox
            id="leads-closed"
            checked={showClosed}
            onCheckedChange={(v) => setShowClosed(v === true)}
          />
          <Label htmlFor="leads-closed" className="cursor-pointer">
            Show closed bids
            {!showClosed && closedCount > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">({closedCount} hidden)</span>
            )}
          </Label>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search title, agency, place…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {leads.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading leads…
        </div>
      )}
      {leads.error && (
        <p className="text-sm text-destructive">Could not load leads: {errText(leads.error)}</p>
      )}
      {counts.error && (
        <p className="text-sm text-destructive">
          Could not load lead counts: {errText(counts.error)}
        </p>
      )}

      {leads.data && shown.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {neverPulled
            ? canWrite
              ? "Nothing pulled yet — press Refresh."
              : "Nothing pulled yet."
            : "No leads match."}
        </div>
      )}

      <div className="space-y-3">
        {shown.map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            canWrite={canWrite}
            busy={busyId === l.id}
            onStatus={(status, note) =>
              setStatus.mutate({ id: l.id, status, ...(note !== undefined ? { note } : {}) })
            }
            onAdd={() => addToProspects.mutate(l.id)}
          />
        ))}
      </div>
    </div>
  );
}
