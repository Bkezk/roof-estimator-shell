/**
 * Construction leads (owner, Sep 28: "is there any way to get data on new builds before
 * they're built giving us time to submit a bid?"). Two public feeds, pulled nightly and when
 * this page loads (throttled to six hours on the server): every state-funded project out for bid
 * on the State of KY planroom, and Louisville Metro's large commercial building permits; more
 * Kentucky sources since, and Tennessee's (STREAM, UT campuses, Nashville permits; then BidNet,
 * Chattanooga permits, Knox County and the universities) from Sep 29, all in one list. A lead can be watched, dismissed, or added to My prospects as a building. Nothing here touches bids.
 * Metro Nashville's, Chattanooga's and (Sep 29) Louisville Metro's own bid lists come in from a
 * nightly browser job instead (GitHub Actions, scripts/browser-bids.ts); the page warns when
 * they stop arriving. Lexington's city bids are pulled with the rest.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Info, Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { isAdmin } from "@/lib/access";
import { BROWSER_SOURCES } from "@/lib/leads-browser";
import {
  LEAD_SOURCES,
  leadCounts,
  listLeads,
  readLeadContacts,
  refreshLeadsIfDue,
  setLeadStatus,
  SOURCE_LABELS,
  type LeadRow,
  type LeadStatus,
  type ListLeadsInput,
} from "@/lib/leads.functions";
import { LeadCard } from "@/components/prospect/lead-card";
import { isClosedBid, lastCheckProblem } from "@/components/prospect/lead-format";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Source = "all" | NonNullable<ListLeadsInput["source"]>;
// Owner (Sep 29): Open, Watching and Dismissed are enough; leads are not put on the map.
type StatusTab = "open" | "watching" | "dismissed";
const TABS: { value: StatusTab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "watching", label: "Watching" },
  { value: "dismissed", label: "Dismissed" },
];

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const ABOUT =
  "State planroom: every state-funded Kentucky project in its bid phase, with pre-bid and bid dates. " +
  "Lynn Imaging bids: every project Lynn prints plans for, statewide (housing authorities, cities, counties, districts, private owners), posted the day plans go out for bid. " +
  "Bowling Green and Paducah bids: those cities' own bid pages. " +
  "Lexington city bids: the Lexington-Fayette Urban County Government's current bids and RFPs (the public list on its Ionwave supplier portal; a bid has no public page of its own, so the card opens the list). " +
  "Louisville Metro bids: Louisville Metro Government's open solicitations with the department and close date (its Bonfire portal, read by the nightly browser job; the card opens the opportunity page). " +
  "University & school planrooms: UK, WKU, NKU, EKU, UofL, Jefferson County Public Schools and KCTCS projects out for bid. " +
  "Federal (SAM.gov): roofing-contractor opportunities with Kentucky or Tennessee as the place of performance. " +
  "Louisville permit: new and addition commercial building permits from Louisville Metro, issued in the last few months. " +
  "Tennessee — TN state projects (STREAM): every state building project out for bid, with the designer to call; " +
  "UT bids: the University of Tennessee campuses' invitations to bid; " +
  "Nashville permits: Metro Nashville commercial new, addition, shell and roofing permits over the minimum cost; " +
  "Chattanooga permits: new non-residential buildings from the Chattanooga-Hamilton County planning agency (runs a month or two behind), over the same minimum cost; " +
  "Knox County bids: Knox County's own solicitations; " +
  "TN university bids: ETSU, Tennessee Tech, Austin Peay, MTSU and the Board of Regents (community colleges, TCATs, TSU). " +
  "Cities, counties & schools (BidNet): the Tennessee and Kentucky purchasing groups on BidNet Direct (cities, counties, school districts, utilities), read once a day; BidNet keeps the issuing agency for members, so the card names the group. A job BidNet repeats from a list above (same title, same state) shows once, from that list, which has the contact. " +
  "Metro Nashville bids and Chattanooga city bids: those cities' own solicitations (the buyer to ask, the close date, Chattanooga's pre-bid meeting), from their Oracle supplier portals; those pages (and Louisville Metro's) only work in a browser, so a nightly job reads them at about 6:15 am Eastern and Refresh does not re-read them. " +
  "The app checks the rest every 6 hours when this page is open, and nightly.";

/** The nightly browser job runs once a day; a source not heard from in this long is late. */
const BROWSER_LATE_MS = 36 * 60 * 60 * 1000;

/**
 * The browser job's sources that have come in before but not lately (a failed run posts
 * nothing, so their leads just stop updating): "Metro Nashville bids (2 days ago)". Null when
 * all are current or never came in (the job not set up yet).
 */
function lateBrowserSources(stamps: unknown, now = Date.now()): string | null {
  const s = (stamps && typeof stamps === "object" ? stamps : {}) as Record<string, unknown>;
  const late = BROWSER_SOURCES.filter((k) => {
    const at = typeof s[k] === "string" ? Date.parse(s[k]) : NaN;
    return Number.isFinite(at) && now - at > BROWSER_LATE_MS;
  }).map(
    (k) =>
      `${SOURCE_LABELS[k] ?? k} (last ${formatDistanceToNow(Date.parse(s[k] as string), { addSuffix: true })})`,
  );
  return late.length ? late.join(", ") : null;
}

export function LeadsPage(props: { initialRoofOnly?: boolean | undefined }) {
  const { can, profile } = useAuth();
  const canWrite = can("prospect");
  const admin = isAdmin(profile);
  const qc = useQueryClient();

  const listFn = useServerFn(listLeads);
  const countsFn = useServerFn(leadCounts);
  const refreshFn = useServerFn(refreshLeadsIfDue);
  const statusFn = useServerFn(setLeadStatus);

  // Roof leads are the page (owner, Sep 29: "we really only need roof bids"); the keyword
  // match is deliberately wide so no new roof, re-roof or roof repair slips past it, and
  // admins can widen it further from the gear.
  const roofOnly = true;
  void props.initialRoofOnly;
  const [source, setSource] = useState<Source>("all");
  // Owner (Sep 29): "a filter to just see KY or just see TN".
  const [state, setState] = useState<"all" | "KY" | "TN">("all");
  const stateArg = state === "all" ? {} : { state };
  const [tab, setTab] = useState<StatusTab>("open");
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  // The box filters the cards at once; the server (the list and the Open count) follows a
  // moment after typing stops.
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const sourceArg = source !== "all" ? { source } : {};
  const searchArg = q ? { q } : {};
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Owner (Sep 29): the browser cuts a long tooltip off before the "Last check" line, so the
  // info icon opens a panel instead.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // The job-page reads after a refresh report apart, so neither hides the other.
  const [pagesError, setPagesError] = useState<string | null>(null);

  const filters = { roofOnly, source, status: tab, state, q };
  const leads = useQuery({
    queryKey: ["leads", filters],
    queryFn: () =>
      listFn({
        data: {
          roofOnly,
          status: tab,
          ...sourceArg,
          ...stateArg,
          ...searchArg,
        },
      }),
    placeholderData: keepPreviousData,
  });
  // The Open count follows the same Source, State and search as the list.
  const counts = useQuery({
    queryKey: ["lead-counts", state, source, q],
    queryFn: () => countsFn({ data: { ...stateArg, ...sourceArg, ...searchArg } }),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["leads"] });
    void qc.invalidateQueries({ queryKey: ["lead-counts"] });
  };

  // After a refresh, read planroom job pages for contacts a few at a time (each call is
  // short); stops when a batch comes back smaller than asked or after eight batches.
  const readFn = useServerFn(readLeadContacts);
  const [reading, setReading] = useState<number | null>(null);
  const readPages = async () => {
    if (reading !== null) return;
    setReading(0);
    setPagesError(null);
    const problems: string[] = [];
    try {
      for (let i = 0; i < 8; i++) {
        const r = await readFn({ data: { max: 6 } });
        problems.push(...r.failed);
        setReading((n) => (n ?? 0) + r.read);
        if (r.read > 0) void qc.invalidateQueries({ queryKey: ["leads"] });
        if (r.read < 6 || problems.length) break;
      }
    } catch (e) {
      problems.push(errText(e));
    } finally {
      setReading(null);
    }
    if (problems.length) {
      const msg = [...new Set(problems)].join("; ");
      setPagesError(msg);
      toast.error(`Planroom pages: ${msg}`);
    }
  };
  const refresh = useMutation({
    // The server answers within about a minute or reports why; past 90 s stop waiting.
    mutationFn: async (force: boolean) => {
      return Promise.race([
        refreshFn({ data: { force } }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "no answer from the server after 90 s — the run may still be going; reload in a minute and check the Checked note",
                ),
              ),
            90000,
          ),
        ),
      ]);
    },
    onSuccess: (r, force) => {
      setRefreshError(r.error);
      if (r.error) toast.error(`Lead refresh: ${r.error}`);
      else if (r.waited) toast.info(r.waited);
      else if (force) toast.success(r.note ?? "Bid board checked");
      if (r.ran) invalidate();
      if (r.ran && counts.data?.planroom_login) void readPages();
    },
    onError: (e) => {
      setRefreshError(errText(e));
      toast.error(`Lead refresh failed: ${errText(e)}`);
    },
  });
  // The lazy pass: a Prospecting user's visit pulls the feeds if the last pull is over six
  // hours old (the server throttles too). Decided here from the counts query so a page whose
  // last check is recent makes no refresh call at all. Once per page load; silent unless it
  // fails.
  const refreshStarted = useRef(false);
  const lastFetchAt = counts.data?.settings?.last_fetch_at ?? null;
  useEffect(() => {
    if (!canWrite || !counts.data || refreshStarted.current) return;
    refreshStarted.current = true;
    const due = !lastFetchAt || Date.now() - Date.parse(lastFetchAt) > SIX_HOURS_MS;
    if (due) refresh.mutate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, [canWrite, counts.data]);
  /** A manual press is in flight (the on-load pass does not hold the button). */
  const pressing = refresh.isPending && refresh.variables === true;

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
  const problem = lastCheckProblem(settings, refreshError, pagesError);
  const lateBrowser = lateBrowserSources(settings?.source_fetched_at);
  const neverPulled = !!counts.data && !settings?.last_fetch_at;
  const openCount = counts.data ? (roofOnly ? counts.data.open_roof : counts.data.open) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Bid Board</h1>
          <p className="text-sm text-muted-foreground">
            Projects out for bid across Kentucky and Louisville commercial permits — new roofs
            before they're built.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {refresh.isPending
              ? "Checking…"
              : reading !== null
                ? `Reading job pages… ${reading}`
                : settings?.last_fetch_at
                  ? `Checked ${formatDistanceToNow(Date.parse(settings.last_fetch_at), { addSuffix: true })}`
                  : counts.data
                    ? "Not checked yet"
                    : ""}
          </span>
          <button
            type="button"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted ${aboutOpen ? "bg-muted" : ""}`}
            aria-label="Where leads come from and what the last check found"
            aria-expanded={aboutOpen}
            title="Where leads come from and what the last check found"
            onClick={() => setAboutOpen((v) => !v)}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              disabled={pressing || reading !== null}
              onClick={() => refresh.mutate(true)}
              title="Pull the lead sources (Kentucky and Tennessee) now; Metro Nashville, Chattanooga and Louisville Metro city bids come in nightly from a browser job"
            >
              {pressing ? (
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
              title="Lead settings: roof keywords and which permits count"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {problem && <p className="text-xs text-destructive">Last check had a problem: {problem}</p>}
      {lateBrowser && (
        <p className="text-xs text-destructive">
          Not updated by the nightly browser job: {lateBrowser}. Its leads may be out of date — the
          “Browser bids” run on GitHub Actions says why.
        </p>
      )}
      {counts.data && !counts.data.planroom_login && (
        <p className="text-xs text-muted-foreground">
          No planroom sign-in on the server yet: state and Lynn cards show contacts and plan holders
          once PLANROOM_EMAIL and PLANROOM_PASSWORD are set in Lovable Cloud.
        </p>
      )}

      {aboutOpen && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          {settings?.last_fetch_note ? (
            <p>
              <span className="font-medium">Last check</span>
              {settings.last_fetch_at
                ? ` (${new Date(settings.last_fetch_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})`
                : ""}
              : {settings.last_fetch_note}
            </p>
          ) : (
            <p>No check has run yet.</p>
          )}
          <p className="text-xs text-muted-foreground">{ABOUT}</p>
        </div>
      )}

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
        <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
          <SelectTrigger className="h-9 w-[130px]" aria-label="State">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Both states</SelectItem>
            <SelectItem value="KY">Kentucky</SelectItem>
            <SelectItem value="TN">Tennessee</SelectItem>
          </SelectContent>
        </Select>
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
          />
        ))}
      </div>
    </div>
  );
}
