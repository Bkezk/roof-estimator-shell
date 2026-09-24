/**
 * Prospecting phase 1 — the Buildings page (docs/roofing-ops-portal-brief.md, MODULES.md).
 * Prospecting finds NEW business. A building here is a prospect: who owns it, what roof is on
 * it and in what condition, and the follow-up tasks to win it. Our own installed roofs are not
 * copied here — they show as a warranty-expiry LEAD LIST read from accepted bids on demand. The
 * map and the parcel ingest come next; this page is what they populate.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Building2,
  CheckSquare,
  ExternalLink,
  FilePlus2,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { isAdmin } from "@/lib/access";
import { KY_COUNTIES } from "@/lib/gis/ky-layers";
import { buildingLine, equivalentRectangle } from "@/lib/prospect";
import {
  deleteBuilding,
  deleteRoof,
  getBuilding,
  listBuildings,
  listProspects,
  setProspectStage,
  PROSPECT_STAGES,
  PROSPECT_STAGE_LABELS,
  type ProspectStage,
  listCounties,
  listOpenTasks,
  listRefreshes,
  listWarrantyLeads,
  addBuildingAtPoint,
  saveBuilding,
  saveRoof,
  saveTask,
  setTaskDone,
  type BuildingDetail,
  type BuildingInput,
  type BuildingRow,
  type RoofInput,
  type RoofRow,
} from "@/lib/prospect.functions";
const ProspectMap = lazy(() => import("@/components/prospect-map"));

import { STATUS_LABELS, asBidStatus } from "@/lib/bid-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
/** What a salesperson reads first: the name, else the address, else the size. */
const rowTitle = (b: {
  name: string;
  address1: string;
  roof_sqft?: number | null;
  building_sqft?: number | null;
}) => {
  if (b.name?.trim()) return b.name;
  if (b.address1?.trim()) return b.address1;
  const a = b.roof_sqft ?? b.building_sqft;
  return a ? `${num(a)} sq ft roof` : "(unnamed building)";
};
/** "roof 22 yrs (2004)" from roof_year, else "built 1998 (roof age unknown)", else null. */
const roofAge = (b: { roof_year?: number | null; year_built?: number | null }) => {
  const y = new Date().getFullYear();
  if (b.roof_year) return `roof ${y - b.roof_year} yrs (${b.roof_year})`;
  if (b.year_built) return `built ${b.year_built}, roof ${y - b.year_built} yrs if original`;
  return null;
};
const rowDetail = (b: {
  name: string;
  address1: string;
  city?: string | null;
  county?: string | null;
  roof_sqft?: number | null;
  roof_year?: number | null;
  year_built?: number | null;
  land_use?: string | null;
}) =>
  [
    b.name?.trim() && b.address1?.trim() ? b.address1 : null,
    b.city,
    b.county && `${b.county} Co.`,
    (b.name?.trim() || b.address1?.trim()) && b.roof_sqft ? `${num(b.roof_sqft)} sq ft roof` : null,
    !b.address1?.trim() ? "no address yet" : null,
    roofAge(b),
    b.land_use,
  ]
    .filter(Boolean)
    .join(" · ");
const summaryLine = (
  b: {
    address1: string;
    city?: string | null;
    county?: string | null;
    roof_sqft?: number | null;
    building_sqft?: number | null;
    perimeter_ft?: number | null;
    roof_year?: number | null;
    year_built?: number | null;
  },
  rect: { width: number; length: number } | null,
) =>
  [
    (b.roof_sqft ?? b.building_sqft)
      ? `${num(b.roof_sqft ?? b.building_sqft)} sq ft roof${
          rect && rect.width > 0 ? ` (about ${rect.width} × ${rect.length} ft)` : ""
        }`
      : "roof size unknown",
    b.address1?.trim() ? [b.address1, b.city].filter(Boolean).join(", ") : "no address yet",
    roofAge(b) ?? "roof age unknown",
    b.county && `${b.county} County`,
  ]
    .filter(Boolean)
    .join(" · ");
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : n.toLocaleString();

/** A blank building form. */
const emptyBuilding = (): BuildingInput => ({
  name: "",
  address1: "",
  address2: null,
  city: null,
  state: "KY",
  zip: null,
  county: null,
  parcel_id: null,
  owner_name: null,
  owner_address: null,
  land_use: null,
  building_sqft: null,
  roof_sqft: null,
  perimeter_ft: null,
  year_built: null,
  roof_year: null,
  stories: null,
  centroid_lat: null,
  centroid_lng: null,
  own_book: false,
  notes: null,
});

/** A blank building pre-filled from a warranty lead (so a lead can become a prospect). */
const buildingFromLead = (l: {
  customerName: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
}): BuildingInput => ({
  ...emptyBuilding(),
  name: l.customerName,
  owner_name: l.customerName,
  address1: l.address,
  city: l.city,
  state: l.state ?? "KY",
  zip: l.zip,
});

const toInput = (b: BuildingRow): BuildingInput => ({
  id: b.id,
  name: b.name,
  address1: b.address1,
  address2: b.address2,
  city: b.city,
  state: b.state,
  zip: b.zip,
  county: b.county,
  parcel_id: b.parcel_id,
  owner_name: b.owner_name,
  owner_address: b.owner_address,
  land_use: b.land_use,
  building_sqft: b.building_sqft,
  roof_sqft: b.roof_sqft,
  perimeter_ft: b.perimeter_ft,
  year_built: b.year_built,
  roof_year: b.roof_year,
  stories: b.stories,
  centroid_lat: b.centroid_lat,
  centroid_lng: b.centroid_lng,
  own_book: b.own_book,
  notes: b.notes,
});

const emptyRoof = (buildingId: string): RoofInput => ({
  building_id: buildingId,
  section_name: "Roof",
  roof_type: null,
  roof_system: null,
  area_sqft: null,
  install_date: null,
  installer: null,
  warranty_type: null,
  warranty_expires: null,
  last_inspection: null,
  condition: null,
  notes: null,
});

const CONDITION_LABELS: Record<string, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  unknown: "Unknown",
};

export function ProspectPage(props: { initialBuildingId?: string | undefined }) {
  const { can, profile } = useAuth();
  const canWrite = can("prospect");
  const canBid = can("estimate");
  const qc = useQueryClient();

  const listFn = useServerFn(listBuildings);
  const countiesFn = useServerFn(listCounties);
  const getFn = useServerFn(getBuilding);
  const saveFn = useServerFn(saveBuilding);
  const deleteFn = useServerFn(deleteBuilding);
  const saveRoofFn = useServerFn(saveRoof);
  const deleteRoofFn = useServerFn(deleteRoof);
  const saveTaskFn = useServerFn(saveTask);
  const doneFn = useServerFn(setTaskDone);
  const openTasksFn = useServerFn(listOpenTasks);
  const prospectsFn = useServerFn(listProspects);
  const stageFn = useServerFn(setProspectStage);
  const leadsFn = useServerFn(listWarrantyLeads);
  const addAtPointFn = useServerFn(addBuildingAtPoint);
  const refreshesFn = useServerFn(listRefreshes);
  const refreshes = useQuery({ queryKey: ["data-refreshes"], queryFn: () => refreshesFn() });

  const [q, setQ] = useState("");
  const [county, setCounty] = useState("");
  const [minAge, setMinAge] = useState("any"); // any | 10 | 15 | 20 | 25 | unknown
  const [minSize, setMinSize] = useState("any"); // any | 5000 | 10000 | 20000 | 50000
  const [sort, setSort] = useState<"recent" | "biggest" | "oldest">("recent");
  const [selectedId, setSelectedId] = useState<string | null>(props.initialBuildingId ?? null);
  const [form, setForm] = useState<BuildingInput | null>(null);
  const [roofForm, setRoofForm] = useState<RoofInput | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  // Salesperson-first (owner rule, Sep 24): the map, the search panel and the prospects list
  // are the whole page; the state's data arrives by the monthly workflow, not by hand.
  const [showMap, setShowMap] = useState(() => {
    try {
      return localStorage.getItem("bid-o-matic:prospect-map") !== "off";
    } catch {
      return true;
    }
  });
  const toggleMap = () =>
    setShowMap((o) => {
      try {
        localStorage.setItem("bid-o-matic:prospect-map", o ? "off" : "on");
      } catch {
        /* private window */
      }
      return !o;
    });
  // The state's outlines for every building: handy for tap-to-add, distracting when you want
  // to look at a roof. Off by default; remembered per browser.
  const [showOutlines, setShowOutlines] = useState(() => {
    try {
      return localStorage.getItem("bid-o-matic:prospect-outlines") === "on";
    } catch {
      return false;
    }
  });
  const [showCities, setShowCities] = useState(() => {
    try {
      return localStorage.getItem("bid-o-matic:prospect-cities") !== "off";
    } catch {
      return true;
    }
  });
  const toggleCities = () =>
    setShowCities((o) => {
      try {
        localStorage.setItem("bid-o-matic:prospect-cities", o ? "off" : "on");
      } catch {
        /* private window */
      }
      return !o;
    });
  const toggleOutlines = () =>
    setShowOutlines((o) => {
      try {
        localStorage.setItem("bid-o-matic:prospect-outlines", o ? "off" : "on");
      } catch {
        /* private window */
      }
      return !o;
    });
  useEffect(() => {
    if (props.initialBuildingId) setSelectedId(props.initialBuildingId);
  }, [props.initialBuildingId]);

  const buildings = useQuery({
    queryKey: ["buildings", q, county, minAge, minSize, sort],
    queryFn: () =>
      listFn({
        data: {
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(county ? { county } : {}),
          ...(minAge === "unknown"
            ? { ageUnknown: true }
            : minAge !== "any"
              ? { minAge: Number(minAge) }
              : {}),
          ...(minSize !== "any" ? { minSqFt: Number(minSize) } : {}),
          sort,
        },
      }),
  });
  const counties = useQuery({ queryKey: ["building-counties"], queryFn: () => countiesFn() });
  const detail = useQuery({
    queryKey: ["building", selectedId],
    queryFn: () => getFn({ data: { id: selectedId! } }),
    enabled: !!selectedId,
  });
  const openTasks = useQuery({ queryKey: ["open-tasks"], queryFn: () => openTasksFn() });
  // The working list: flagged buildings, newest first (listProspects).
  const prospects = useQuery({ queryKey: ["prospects"], queryFn: () => prospectsFn() });
  // The search panel over the map can be tucked away to see the whole map.
  const [showSearch, setShowSearch] = useState(true);
  const leads = useQuery({
    queryKey: ["warranty-leads"],
    queryFn: () => leadsFn(),
    enabled: canWrite,
  });

  // The detail form follows the selected building; edits are local until Save.
  useEffect(() => {
    if (detail.data) setForm(toInput(detail.data.building));
  }, [detail.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["buildings"] });
    void qc.invalidateQueries({ queryKey: ["building-counties"] });
    void qc.invalidateQueries({ queryKey: ["building", selectedId] });
    void qc.invalidateQueries({ queryKey: ["open-tasks"] });
    void qc.invalidateQueries({ queryKey: ["prospects"] });
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  const stage = useMutation({
    mutationFn: (v: { id: string; stage: ProspectStage | null }) => stageFn({ data: v }),
    onSuccess: (row, v) => {
      toast.success(
        v.stage ? `${rowTitle(row)} — ${PROSPECT_STAGE_LABELS[v.stage]}` : "Taken off the list",
      );
      // Patch the caches in place: refetching the 500-row search and the county counts for a
      // one-row flag is what made the star feel slow.
      const patch = (b: BuildingRow) => (b.id === row.id ? { ...b, ...row } : b);
      qc.setQueriesData<BuildingRow[]>({ queryKey: ["buildings"] }, (list) => list?.map(patch));
      qc.setQueryData<BuildingRow[]>(["prospects"], (list) => {
        const rest = (list ?? []).filter((b) => b.id !== row.id);
        return row.prospect_stage ? [row, ...rest] : rest;
      });
      qc.setQueryData<BuildingDetail>(["building", v.id], (d) =>
        d ? { ...d, building: { ...d.building, ...row } } : d,
      );
      void qc.invalidateQueries({ queryKey: ["prospects"] });
    },
    onError: fail,
  });

  const save = useMutation({
    mutationFn: (b: BuildingInput) => saveFn({ data: b }),
    onSuccess: (row) => {
      toast.success("Building saved");
      setSelectedId(row.id);
      invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Building removed");
      setSelectedId(null);
      setForm(null);
      invalidate();
    },
    onError: fail,
  });
  const saveRoofM = useMutation({
    mutationFn: (r: RoofInput) => saveRoofFn({ data: r }),
    onSuccess: () => {
      setRoofForm(null);
      invalidate();
    },
    onError: fail,
  });
  const deleteRoofM = useMutation({
    mutationFn: (id: string) => deleteRoofFn({ data: { id } }),
    onSuccess: invalidate,
    onError: fail,
  });
  const addTask = useMutation({
    mutationFn: () =>
      saveTaskFn({
        data: {
          title: taskTitle.trim(),
          due_date: taskDue || null,
          building_id: selectedId,
        },
      }),
    onSuccess: () => {
      setTaskTitle("");
      setTaskDue("");
      invalidate();
    },
    onError: fail,
  });
  const toggleTask = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => doneFn({ data: v }),
    onSuccess: invalidate,
    onError: fail,
  });
  const tapAdd = useMutation({
    mutationFn: (p: { lng: number; lat: number }) => addAtPointFn({ data: p }),
    onSuccess: (r) => {
      if (!r.id) {
        toast.info("No building outline under that spot — zoom in and tap inside an outline");
        return;
      }
      const size = r.roofSqFt ? ` — ${r.roofSqFt.toLocaleString()} sq ft roof` : "";
      if (r.existed) toast.info(`Opened${size}`);
      else {
        toast.success(`Outline added and opened${size}`);
        invalidate();
      }
      setSelectedId(r.id);
    },
    onError: fail,
  });
  // Stable list for the map: a fresh array on every render would make the map re-frame the
  // view (and jump the zoom) whenever anything else on the page changed, such as a toggle.
  const mapBuildings = useMemo(
    () =>
      (buildings.data ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        address1: b.address1,
        lat: b.centroid_lat,
        lng: b.centroid_lng,
        footprint: b.footprint,
        roofSqFt: b.roof_sqft,
      })),
    [buildings.data],
  );
  const rect = useMemo(() => {
    const b = detail.data?.building;
    if (!b) return null;
    const area = b.roof_sqft ?? b.building_sqft;
    return area ? equivalentRectangle(area, b.perimeter_ft) : null;
  }, [detail.data]);

  const setF = <K extends keyof BuildingInput>(k: K, v: BuildingInput[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const text = (k: keyof BuildingInput, label: string, width = "") => (
    <div className={width}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="h-8"
        value={(form?.[k] as string | null | undefined) ?? ""}
        disabled={!canWrite}
        onChange={(e) => setF(k, (e.target.value || null) as BuildingInput[typeof k])}
      />
    </div>
  );
  const number = (k: keyof BuildingInput, label: string, step = "1") => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <NumberField
        className="h-8"
        step={step}
        value={(form?.[k] as number | null | undefined) ?? 0}
        disabled={!canWrite}
        onChange={(n) => setF(k, (n > 0 ? n : null) as BuildingInput[typeof k])}
      />
    </div>
  );

  // The find-buildings panel: search, filters and results. Over the map's left side when the
  // map is on (it can be tucked away); a plain card in the left column when the map is off.
  const searchCard = (
    <Card className="flex max-h-full flex-col">
      <CardHeader className="space-y-2 pb-2">
        <Input
          placeholder="Search name, address, owner, parcel…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Select value={county || "all"} onValueChange={(v) => setCounty(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 flex-1">
              <SelectValue placeholder="All counties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All counties</SelectItem>
              {(counties.data ?? []).map((c) => (
                <SelectItem key={c.county} value={c.county}>
                  {c.county} ({c.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Select value={minAge} onValueChange={setMinAge}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any roof age</SelectItem>
              <SelectItem value="10">Roof 10+ yrs</SelectItem>
              <SelectItem value="15">Roof 15+ yrs</SelectItem>
              <SelectItem value="20">Roof 20+ yrs</SelectItem>
              <SelectItem value="25">Roof 25+ yrs</SelectItem>
              <SelectItem value="unknown">Age unknown</SelectItem>
            </SelectContent>
          </Select>
          <Select value={minSize} onValueChange={setMinSize}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any size</SelectItem>
              <SelectItem value="5000">5,000+ sq ft</SelectItem>
              <SelectItem value="10000">10,000+ sq ft</SelectItem>
              <SelectItem value="20000">20,000+ sq ft</SelectItem>
              <SelectItem value="50000">50,000+ sq ft</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recent first</SelectItem>
              <SelectItem value="biggest">Biggest roof</SelectItem>
              <SelectItem value="oldest">Oldest roof</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canWrite && (
          <button
            type="button"
            className="text-left text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => {
              setSelectedId(null);
              setForm(emptyBuilding());
            }}
          >
            <Plus className="mr-1 inline h-3 w-3" /> Not listed? Add a building by hand
          </button>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {buildings.isLoading && <p className="p-2 text-xs text-muted-foreground">Loading…</p>}
        {buildings.data?.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            No buildings match. Change the filters, or load the county's data.
          </p>
        )}
        {(buildings.data ?? []).map((b) => (
          <div
            key={b.id}
            className={`flex items-start gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${
              selectedId === b.id ? "bg-primary/15" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => setSelectedId(b.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{rowTitle(b)}</span>
                {b.prospect_stage && (
                  <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium">
                    {PROSPECT_STAGE_LABELS[b.prospect_stage as ProspectStage] ?? b.prospect_stage}
                  </span>
                )}
              </div>
              <div className="pl-6 text-xs text-muted-foreground">{rowDetail(b)}</div>
            </button>
            {canWrite && !b.prospect_stage && (
              <button
                type="button"
                className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-primary/15 hover:text-foreground"
                title="Add to my prospects"
                aria-label={`Add ${rowTitle(b)} to my prospects`}
                disabled={stage.isPending}
                onClick={() => stage.mutate({ id: b.id, stage: "prospect" })}
              >
                <Star className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Buildings</h1>
          <p className="text-sm text-muted-foreground">
            Your prospects, and every commercial building in Kentucky to find the next one.
            {(refreshes.data?.length ?? 0) > 0 && (
              <span className="ml-1 text-xs">
                Data refreshed {new Date(refreshes.data![0]!.ran_at).toLocaleDateString()} (
                {refreshes.data!.length} of {KY_COUNTIES.length} counties)
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={toggleMap}>
            <MapIcon className="mr-1 h-4 w-4" /> {showMap ? "Hide map" : "Show map"}
          </Button>
          {showMap && (
            <Button
              size="sm"
              variant={showOutlines ? "secondary" : "outline"}
              onClick={toggleOutlines}
              title="Draw every building outline in the state when zoomed in; tap one to add it"
            >
              {showOutlines ? "Outlines on" : "Outlines off"}
            </Button>
          )}
          {showMap && (
            <Button
              size="sm"
              variant={showCities ? "secondary" : "outline"}
              onClick={toggleCities}
              title="Name the eight largest cities in view; they fade out as you zoom in"
            >
              {showCities ? "Cities on" : "Cities off"}
            </Button>
          )}
          {isAdmin(profile) && (
            /* The state's data is loaded by the monthly GitHub workflow (docs/TODO.md item 3);
               this opens its page, where "Run workflow" refreshes one county or all of them. */
            <Button asChild size="sm" variant="outline">
              <a
                href="https://github.com/Bkezk/roof-estimator-shell/actions/workflows/refresh-kentucky.yml"
                target="_blank"
                rel="noreferrer"
                title="Runs on the 1st of each month; open to refresh a county now"
              >
                <ExternalLink className="mr-1 h-4 w-4" /> Refresh data
              </a>
            </Button>
          )}
        </div>
      </div>

      {showMap && (
        <Suspense fallback={<div className="h-[420px] w-full rounded-md border bg-muted/30" />}>
          <div className="relative">
            <ProspectMap
              buildings={mapBuildings}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showOutlines={showOutlines}
              showCities={showCities}
              {...(canWrite
                ? { onTapEmpty: (lng: number, lat: number) => tapAdd.mutate({ lng, lat }) }
                : {})}
            />
            {/* Find-buildings panel over the map's left side (owner, Sep 24): search, filters
                and results sit on the map so the space below is the prospects list. */}
            <div className="pointer-events-none absolute inset-y-3 left-3 z-10 flex w-[min(360px,calc(100%-24px))] flex-col gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="pointer-events-auto w-fit shadow"
                onClick={() => setShowSearch((o) => !o)}
                title={showSearch ? "Hide the search panel" : "Search the state's buildings"}
              >
                {showSearch ? (
                  <PanelLeftClose className="mr-1 h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="mr-1 h-4 w-4" />
                )}
                {showSearch ? "Hide search" : "Find buildings"}
              </Button>
              {showSearch && (
                <div className="pointer-events-auto min-h-0 flex-1 overflow-hidden rounded-lg shadow-lg [&>div]:h-full [&>div]:bg-background/95 [&>div]:backdrop-blur">
                  {searchCard}
                </div>
              )}
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Blue outlines are the buildings in the search results.
            {showOutlines
              ? ` Zoom in and every building outline in the state appears${canWrite ? "; tap one to open it, then “Add to my prospects”" : ""}.`
              : " Turn “Outlines on” to see every building in the state and tap one to open it."}
          </p>
        </Suspense>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* ── Left column: the working list (and the search card when the map is hidden) ── */}
        <div className="space-y-4">
          {!showMap && searchCard}
          {/* ── My prospects: the working list ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Star className="h-4 w-4" /> My prospects
                <span className="text-xs font-normal text-muted-foreground">
                  {prospects.data?.length ?? 0}
                </span>
              </CardTitle>
              <CardDescription className="text-xs">
                Buildings someone flagged. Find more on the map (the star on a result), tap an
                outline, or add one by hand.
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
              {prospects.isLoading && <p className="p-2 text-xs text-muted-foreground">Loading…</p>}
              {prospects.data?.length === 0 && (
                <p className="p-2 text-xs text-muted-foreground">
                  Nothing flagged yet. Search the map above and press the star on a building.
                </p>
              )}
              {(prospects.data ?? []).map((b) => (
                <div
                  key={b.id}
                  className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${
                    selectedId === b.id ? "bg-primary/15" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{rowTitle(b)}</span>
                    </div>
                    <div className="pl-6 text-xs text-muted-foreground">
                      {rowDetail(b)}
                      {b.prospect_owner_name ? ` · ${b.prospect_owner_name}` : ""}
                    </div>
                  </button>
                  {canWrite ? (
                    <Select
                      value={b.prospect_stage ?? "prospect"}
                      onValueChange={(v) =>
                        stage.mutate({
                          id: b.id,
                          stage: v === "remove" ? null : (v as ProspectStage),
                        })
                      }
                    >
                      <SelectTrigger className="h-7 w-[112px] text-xs" aria-label="Prospect stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROSPECT_STAGES.map((st) => (
                          <SelectItem key={st} value={st}>
                            {PROSPECT_STAGE_LABELS[st]}
                          </SelectItem>
                        ))}
                        <SelectItem value="remove">Remove from list</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {PROSPECT_STAGE_LABELS[b.prospect_stage as ProspectStage] ?? b.prospect_stage}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ── Detail ── */}
        <div className="space-y-4">
          {!form ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
                <p>Select a prospect on the left, or add one.</p>
                {canWrite && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
                      <ShieldCheck className="h-4 w-4" /> Warranty leads — roofs we installed,
                      soonest expiry first
                    </p>
                    {leads.data?.length === 0 && <p className="text-xs">No accepted bids yet.</p>}
                    <ul className="space-y-1">
                      {(leads.data ?? []).slice(0, 25).map((l) => (
                        <li key={l.bidId} className="flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="font-medium text-foreground">{l.customerName}</span>
                          <span>{[l.address, l.city].filter(Boolean).join(", ")}</span>
                          <span>
                            {l.expires
                              ? `${l.warrantyName} · expires ${l.expires} (${
                                  l.yearsLeft !== null && l.yearsLeft < 0
                                    ? "expired"
                                    : `${l.yearsLeft} yr left`
                                })`
                              : "warranty length unknown"}
                          </span>
                          {l.buildingId ? (
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={() => setSelectedId(l.buildingId)}
                            >
                              open prospect
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={() => {
                                setSelectedId(null);
                                setForm(buildingFromLead(l));
                              }}
                            >
                              add as prospect
                            </button>
                          )}
                          {canBid && (
                            <Link
                              to="/estimate"
                              search={{ bid: l.bidId }}
                              className="underline underline-offset-2"
                            >
                              bid
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(openTasks.data?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1 font-medium text-foreground">Open tasks</p>
                    <ul className="space-y-1">
                      {(openTasks.data ?? []).map((t) => (
                        <li key={t.id} className="flex items-center gap-2">
                          <CheckSquare className="h-3.5 w-3.5" />
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => t.building_id && setSelectedId(t.building_id)}
                          >
                            {t.title}
                          </button>
                          {t.due_date && <span className="text-xs">due {t.due_date}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <div>
                    <CardTitle className="text-base">
                      {form.id ? rowTitle(form) : "New building"}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {form.id
                        ? summaryLine(form, rect)
                        : "Saves as a prospect in the Buildings list. Type what you know; anything can be left blank."}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {form.id && canBid && (
                      /* The estimator gets plain values in the URL (its own generic prefill);
                         nothing here imports estimator code, and it imports nothing from here. */
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to="/estimate"
                          search={{
                            building: form.id,
                            ...(form.name ? { pfName: form.name } : {}),
                            ...(form.owner_name ? { pfOwner: form.owner_name } : {}),
                            ...(form.address1 ? { pfAddr: form.address1 } : {}),
                            ...(form.address2 ? { pfAddr2: form.address2 } : {}),
                            ...(form.city ? { pfCity: form.city } : {}),
                            ...(form.state ? { pfState: form.state } : {}),
                            ...(form.zip ? { pfZip: form.zip } : {}),
                            ...(rect && rect.width > 0
                              ? { pfW: rect.width, pfL: rect.length }
                              : {}),
                          }}
                        >
                          <FilePlus2 className="mr-1 h-4 w-4" /> New bid from this building
                        </Link>
                      </Button>
                    )}
                    {form.id && canWrite && !detail.data?.building.prospect_stage && (
                      <Button
                        size="sm"
                        disabled={stage.isPending}
                        onClick={() => stage.mutate({ id: form.id!, stage: "prospect" })}
                      >
                        <Star className="mr-1 h-4 w-4" /> Add to my prospects
                      </Button>
                    )}
                    {form.id && canWrite && !!detail.data?.building.prospect_stage && (
                      <Select
                        value={detail.data?.building.prospect_stage ?? "none"}
                        onValueChange={(v) =>
                          stage.mutate({
                            id: form.id!,
                            stage: v === "none" ? null : (v as ProspectStage),
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-[150px] text-xs"
                          aria-label="Prospect stage"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Remove from my prospects</SelectItem>
                          {PROSPECT_STAGES.map((st) => (
                            <SelectItem key={st} value={st}>
                              {PROSPECT_STAGE_LABELS[st]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setForm(null);
                        setSelectedId(null);
                      }}
                    >
                      Cancel
                    </Button>
                    {canWrite && (
                      <Button
                        size="sm"
                        onClick={() => save.mutate(form)}
                        disabled={save.isPending || (!form.name.trim() && !form.address1.trim())}
                      >
                        {form.id ? "Save" : "Save as prospect"}
                      </Button>
                    )}
                    {form.id && canWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          if (
                            confirm(
                              "Remove this building? Its roofs and tasks stay attached to it in history.",
                            )
                          )
                            remove.mutate(form.id!);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {text("name", "Building / business name", "sm:col-span-2")}
                  {text("owner_name", "Owner of record", "sm:col-span-2")}
                  {text("address1", "Address", "sm:col-span-2")}
                  {text("address2", "Address 2")}
                  {text("city", "City")}
                  {text("state", "State")}
                  {text("zip", "Zip")}
                  {text("county", "County")}
                  {text("parcel_id", "Parcel ID")}
                  {text("owner_address", "Owner mailing address", "sm:col-span-2")}
                  {text("land_use", "Land use")}
                  {number("roof_year", "Roof installed (year)")}
                  {number("year_built", "Year built")}
                  {number("building_sqft", "Building sq ft")}
                  {number("roof_sqft", "Roof sq ft")}
                  {number("perimeter_ft", "Roof perimeter (ft)")}
                  {number("stories", "Stories")}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <Textarea
                      rows={2}
                      value={form.notes ?? ""}
                      disabled={!canWrite}
                      onChange={(e) => setF("notes", e.target.value || null)}
                    />
                  </div>
                  {rect && (
                    <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
                      A new bid from this building starts with one {rect.width} × {rect.length} ft
                      section (same area{form.perimeter_ft ? " and perimeter" : ""} as the roof).
                    </p>
                  )}
                </CardContent>
              </Card>

              {form.id && detail.data && (
                <div className="grid items-start gap-4 lg:grid-cols-2">
                  {/* Roofs */}
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm">Existing roof</CardTitle>
                      {canWrite && !roofForm && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRoofForm(emptyRoof(form.id!))}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" /> Add roof
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {detail.data.roofs.length === 0 && !roofForm && (
                        <p className="text-xs text-muted-foreground">
                          Nothing recorded about the roof yet.
                        </p>
                      )}
                      {detail.data.roofs.length > 0 && (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Section</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead className="text-right">Sq ft</TableHead>
                              <TableHead>Installed</TableHead>
                              <TableHead>Condition</TableHead>
                              <TableHead>Warranty</TableHead>
                              <TableHead className="w-8" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.data.roofs.map((r: RoofRow) => (
                              <TableRow
                                key={r.id}
                                className="cursor-pointer text-xs"
                                onClick={() =>
                                  canWrite &&
                                  setRoofForm({
                                    id: r.id,
                                    building_id: r.building_id,
                                    section_name: r.section_name,
                                    roof_type: r.roof_type,
                                    roof_system: r.roof_system,
                                    area_sqft: r.area_sqft,
                                    install_date: r.install_date,
                                    installer: r.installer,
                                    warranty_type: r.warranty_type,
                                    warranty_expires: r.warranty_expires,
                                    last_inspection: r.last_inspection,
                                    condition: (r.condition ?? null) as RoofInput["condition"],
                                    notes: r.notes,
                                  })
                                }
                              >
                                <TableCell className="font-medium">{r.section_name}</TableCell>
                                <TableCell>{r.roof_type ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {num(r.area_sqft)}
                                </TableCell>
                                <TableCell>{r.install_date ?? "—"}</TableCell>
                                <TableCell>
                                  {r.condition ? CONDITION_LABELS[r.condition] : "—"}
                                </TableCell>
                                <TableCell>
                                  {r.warranty_type ?? "—"}
                                  {r.warranty_expires && (
                                    <span className="block text-muted-foreground">
                                      to {r.warranty_expires}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                  {canWrite && (
                                    <button
                                      type="button"
                                      className="text-destructive"
                                      onClick={() => deleteRoofM.mutate(r.id)}
                                      aria-label="Remove roof"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      {roofForm && (
                        <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                          <RoofField
                            label="Section"
                            value={roofForm.section_name}
                            onChange={(v) => setRoofForm({ ...roofForm, section_name: v })}
                          />
                          <RoofField
                            label="Existing roof type"
                            value={roofForm.roof_type ?? ""}
                            onChange={(v) => setRoofForm({ ...roofForm, roof_type: v || null })}
                          />
                          <div>
                            <Label className="text-xs text-muted-foreground">Area (sq ft)</Label>
                            <NumberField
                              className="h-8"
                              value={roofForm.area_sqft ?? 0}
                              onChange={(n) =>
                                setRoofForm({ ...roofForm, area_sqft: n > 0 ? n : null })
                              }
                            />
                          </div>
                          <RoofField
                            label="Installed (approx.)"
                            type="date"
                            value={roofForm.install_date ?? ""}
                            onChange={(v) => setRoofForm({ ...roofForm, install_date: v || null })}
                          />
                          <div>
                            <Label className="text-xs text-muted-foreground">Condition</Label>
                            <Select
                              value={roofForm.condition ?? "unknown"}
                              onValueChange={(v) =>
                                setRoofForm({ ...roofForm, condition: v as RoofInput["condition"] })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                                  <SelectItem key={k} value={k}>
                                    {v}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <RoofField
                            label="Warranty type"
                            value={roofForm.warranty_type ?? ""}
                            onChange={(v) => setRoofForm({ ...roofForm, warranty_type: v || null })}
                          />
                          <RoofField
                            label="Warranty expires"
                            type="date"
                            value={roofForm.warranty_expires ?? ""}
                            onChange={(v) =>
                              setRoofForm({ ...roofForm, warranty_expires: v || null })
                            }
                          />
                          <RoofField
                            label="Last inspection"
                            type="date"
                            value={roofForm.last_inspection ?? ""}
                            onChange={(v) =>
                              setRoofForm({ ...roofForm, last_inspection: v || null })
                            }
                          />
                          <div className="flex items-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => saveRoofM.mutate(roofForm)}
                              disabled={!roofForm.section_name.trim()}
                            >
                              {roofForm.id ? "Update roof" : "Add roof"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRoofForm(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Tasks + bids */}
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Tasks</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {detail.data.tasks.length === 0 && (
                          <p className="text-xs text-muted-foreground">No tasks.</p>
                        )}
                        {detail.data.tasks.map((t) => (
                          <label key={t.id} className="flex items-start gap-2 text-sm">
                            <Checkbox
                              className="mt-0.5"
                              checked={t.status === "done"}
                              disabled={!canWrite}
                              onCheckedChange={(v) =>
                                toggleTask.mutate({ id: t.id, done: v === true })
                              }
                            />
                            <span
                              className={
                                t.status === "done" ? "line-through text-muted-foreground" : ""
                              }
                            >
                              {t.title}
                              {t.due_date && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  due {t.due_date}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                        {canWrite && (
                          <div className="flex flex-wrap items-end gap-2 pt-1">
                            <div className="min-w-[180px] flex-1">
                              <Label className="text-xs text-muted-foreground">New task</Label>
                              <Input
                                className="h-8"
                                value={taskTitle}
                                onChange={(e) => setTaskTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && taskTitle.trim()) addTask.mutate();
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Due</Label>
                              <Input
                                className="h-8"
                                type="date"
                                value={taskDue}
                                onChange={(e) => setTaskDue(e.target.value)}
                              />
                            </div>
                            <Button
                              size="sm"
                              onClick={() => addTask.mutate()}
                              disabled={!taskTitle.trim()}
                            >
                              Add
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Bids on this building</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 text-sm">
                        {detail.data.bids.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            None yet{canBid ? " — use “New bid from this building”." : "."}
                          </p>
                        )}
                        {detail.data.bids.map((b) => (
                          <div key={b.id} className="flex items-center justify-between gap-2">
                            {canBid ? (
                              <Link
                                to="/estimate"
                                search={{ bid: b.id }}
                                className="underline underline-offset-2"
                              >
                                {b.name}
                              </Link>
                            ) : (
                              <span>{b.name}</span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {STATUS_LABELS[asBidStatus(b.status)]} · {usd(b.grand_total)}
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RoofField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      <Input
        className="h-8"
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
