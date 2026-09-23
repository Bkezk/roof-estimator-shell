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
  DownloadCloud,
  FilePlus2,
  Map as MapIcon,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { buildingLine, equivalentRectangle } from "@/lib/prospect";
import {
  deleteBuilding,
  deleteRoof,
  getBuilding,
  countAddressPoints,
  fillFootprintAddresses,
  importLayer,
  listBuildings,
  listCounties,
  listOpenTasks,
  listWarrantyLeads,
  previewLayer,
  saveBuilding,
  saveRoof,
  saveTask,
  setTaskDone,
  type BuildingInput,
  type BuildingRow,
  type LayerPreview,
  type RoofInput,
  type RoofRow,
} from "@/lib/prospect.functions";
import {
  KY_ADDRESS_POINTS_LAYER,
  KY_CORE_COUNTIES,
  KY_COUNTIES,
  KY_FOOTPRINTS_LAYER,
  KY_SCHOOLS_LAYER,
  KY_WEBSTER_PARCELS_LAYER,
  countyRankingUrl,
  countyWhere,
  type LayerKind,
} from "@/lib/gis/ky-layers";

const ProspectMap = lazy(() => import("@/components/prospect-map"));

/** The Kentucky layers whose fields are sample-verified (src/lib/gis/fixtures). */
const LAYER_PRESETS: { key: string; label: string; url: string; kind: LayerKind }[] = [
  {
    key: "footprints",
    label: "Building footprints — ORNL, statewide",
    url: KY_FOOTPRINTS_LAYER,
    kind: "footprint",
  },
  {
    key: "addresses",
    label: "911 address points — statewide (addresses for footprints)",
    url: KY_ADDRESS_POINTS_LAYER,
    kind: "address",
  },
  { key: "schools", label: "Schools — statewide", url: KY_SCHOOLS_LAYER, kind: "facility" },
  {
    key: "webster",
    label: "PVA parcels — Webster County (the only county the state publishes)",
    url: KY_WEBSTER_PARCELS_LAYER,
    kind: "parcel",
  },
  { key: "custom", label: "Another layer URL…", url: "", kind: "facility" },
];
const COUNTY_CHOICES = [
  ...KY_CORE_COUNTIES,
  ...KY_COUNTIES.filter((c) => !KY_CORE_COUNTIES.includes(c)),
];
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
  const { can } = useAuth();
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
  const leadsFn = useServerFn(listWarrantyLeads);
  const previewFn = useServerFn(previewLayer);
  const importFn = useServerFn(importLayer);
  const fillFn = useServerFn(fillFootprintAddresses);
  const addressCountsFn = useServerFn(countAddressPoints);

  const [q, setQ] = useState("");
  const [county, setCounty] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(props.initialBuildingId ?? null);
  const [form, setForm] = useState<BuildingInput | null>(null);
  const [roofForm, setRoofForm] = useState<RoofInput | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  // Kentucky layer import (src/lib/gis/ky-layers.ts): a preset (or any layer URL), a county and
  // a where clause the preset writes and the operator may edit.
  const [importOpen, setImportOpen] = useState(false);
  const [presetKey, setPresetKey] = useState("footprints");
  const preset = LAYER_PRESETS.find((p) => p.key === presetKey) ?? LAYER_PRESETS[0]!;
  const [customUrl, setCustomUrl] = useState("");
  const layerUrl = preset.key === "custom" ? customUrl : preset.url;
  const [importCounty, setImportCounty] = useState<string>(KY_CORE_COUNTIES[0]!);
  const [minSqFt, setMinSqFt] = useState(5000);
  const [whereClause, setWhereClause] = useState(() =>
    countyWhere("footprint", KY_CORE_COUNTIES[0]!, 5000),
  );
  const [preview, setPreview] = useState<LayerPreview | null>(null);
  const [showMap, setShowMap] = useState(false);
  useEffect(() => {
    // Parcels are one layer per county: the county is the layer's.
    const county = preset.kind === "parcel" ? "Webster" : importCounty;
    if (preset.kind === "parcel" && importCounty !== "Webster") setImportCounty("Webster");
    setWhereClause(preset.key === "custom" ? "1=1" : countyWhere(preset.kind, county, minSqFt));
    setPreview(null);
  }, [preset, importCounty, minSqFt]);

  useEffect(() => {
    if (props.initialBuildingId) setSelectedId(props.initialBuildingId);
  }, [props.initialBuildingId]);

  const buildings = useQuery({
    queryKey: ["buildings", q, county],
    queryFn: () =>
      listFn({
        data: {
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(county ? { county } : {}),
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
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

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
  const previewM = useMutation({
    mutationFn: () => previewFn({ data: { layerUrl: layerUrl.trim(), where: whereClause } }),
    onSuccess: setPreview,
    onError: fail,
  });
  const importM = useMutation({
    mutationFn: () =>
      importFn({
        data: { layerUrl: layerUrl.trim(), where: whereClause, county: importCounty },
      }),
    onSuccess: (r) => {
      const what =
        r.kind === "address" ? "address point" : r.kind === "parcel" ? "parcel" : "building";
      toast.success(
        `${r.upserted.toLocaleString()} ${what}${r.upserted === 1 ? "" : "s"} imported or updated (${r.fetched.toLocaleString()} read${
          r.skipped ? `, ${r.skipped} unusable skipped` : ""
        })`,
      );
      invalidate();
      void qc.invalidateQueries({ queryKey: ["address-point-counts"] });
    },
    onError: fail,
  });
  const addressCounts = useQuery({
    queryKey: ["address-point-counts"],
    queryFn: () => addressCountsFn(),
    enabled: importOpen && canWrite,
  });
  const fillM = useMutation({
    mutationFn: () => fillFn({ data: { county: importCounty } }),
    onSuccess: (r) => {
      toast.success(`${r.updated.toLocaleString()} footprints given an address`);
      invalidate();
    },
    onError: fail,
  });
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Buildings</h1>
          <p className="text-sm text-muted-foreground">
            Prospects: the roofs we want to win, who owns them, and what to do next.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowMap((o) => !o)}>
            <MapIcon className="mr-1 h-4 w-4" /> {showMap ? "Hide map" : "Map"}
          </Button>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => setImportOpen((o) => !o)}>
              <DownloadCloud className="mr-1 h-4 w-4" /> Import buildings
            </Button>
          )}
          {canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setSelectedId(null);
                setForm(emptyBuilding());
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add building
            </Button>
          )}
        </div>
      </div>

      {showMap && (
        <Suspense fallback={<div className="h-[420px] w-full rounded-md border bg-muted/30" />}>
          <ProspectMap
            buildings={(buildings.data ?? []).map((b) => ({
              id: b.id,
              name: b.name,
              address1: b.address1,
              lat: b.centroid_lat,
              lng: b.centroid_lng,
              footprint: b.footprint,
              roofSqFt: b.roof_sqft,
            }))}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      )}

      {importOpen && canWrite && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Import buildings from a Kentucky layer</CardTitle>
            <CardDescription className="text-xs">
              Free statewide GIS. Footprints give every building&apos;s roof area and outline (no
              owner, usually no address); 911 address points then lend the nearest address; the
              facility lists (schools, …) come with a name and address. Preview reads the layer and
              counts the matches; Import upserts them, so running it again updates rather than
              duplicates. Owner of record is not published statewide — it stays a per-county PVA
              lookup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_200px_140px]">
              <div>
                <Label className="text-xs text-muted-foreground">Layer</Label>
                <Select value={presetKey} onValueChange={setPresetKey}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LAYER_PRESETS.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">County</Label>
                <Select
                  value={importCounty}
                  onValueChange={setImportCounty}
                  disabled={preset.kind === "parcel"}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTY_CHOICES.map((c, i) => (
                      <SelectItem key={c} value={c}>
                        {i < KY_CORE_COUNTIES.length ? `${i + 1}. ${c}` : c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Min roof sq ft</Label>
                <NumberField
                  className="h-8"
                  value={minSqFt}
                  min={0}
                  step="1000"
                  disabled={preset.kind !== "footprint"}
                  onChange={(v) => setMinSqFt(Math.max(0, Math.round(v)))}
                />
              </div>
            </div>
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <Label className="text-xs text-muted-foreground">Layer URL</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  value={layerUrl}
                  readOnly={preset.key !== "custom"}
                  placeholder="https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/…/MapServer/0"
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Where (ArcGIS SQL)</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  value={whereClause}
                  onChange={(e) => setWhereClause(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => previewM.mutate()}
                disabled={previewM.isPending || !layerUrl.trim()}
              >
                {previewM.isPending ? "Reading layer…" : "Preview"}
              </Button>
              <Button
                size="sm"
                onClick={() => importM.mutate()}
                disabled={!preview || importM.isPending}
              >
                {importM.isPending
                  ? "Importing…"
                  : preview
                    ? `Import ${preview.total.toLocaleString()} ${
                        preview.kind === "address"
                          ? "address points"
                          : preview.kind === "parcel"
                            ? "parcels"
                            : "buildings"
                      }`
                    : "Import"}
              </Button>
              {preview && (
                <span className="text-xs text-muted-foreground">
                  {preview.kind} layer · {preview.total.toLocaleString()} match · page size{" "}
                  {preview.maxRecordCount ?? "?"} ·{" "}
                  {Object.entries(preview.mapping)
                    .map(([k, v]) => `${k} ← ${v}`)
                    .join(", ")}
                </span>
              )}
            </div>
            {preview && preview.sample.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>County</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">
                      {preview.kind === "parcel" ? "Lot sq ft" : "Roof sq ft"}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sample.map((c) => (
                    <TableRow key={c.key} className="text-xs">
                      <TableCell className="font-mono">{c.key}</TableCell>
                      <TableCell>{c.name ?? "—"}</TableCell>
                      <TableCell>{c.address ?? "—"}</TableCell>
                      <TableCell>{c.city ?? "—"}</TableCell>
                      <TableCell>{c.county ?? "—"}</TableCell>
                      <TableCell>{c.cls ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(c.sqft)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>
                Addresses for footprints: {importCounty} has{" "}
                {(
                  addressCounts.data?.find((c) => c.county === importCounty)?.count ?? 0
                ).toLocaleString()}{" "}
                imported 911 points.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fillM.mutate()}
                disabled={
                  fillM.isPending ||
                  !(addressCounts.data?.find((c) => c.county === importCounty)?.count ?? 0)
                }
              >
                {fillM.isPending
                  ? "Matching…"
                  : `Fill ${importCounty} footprint addresses (nearest point within 60 m)`}
              </Button>
              <a
                className="underline underline-offset-2"
                href={countyRankingUrl(KY_FOOTPRINTS_LAYER, minSqFt)}
                target="_blank"
                rel="noreferrer"
              >
                buildings ≥ {minSqFt.toLocaleString()} sq ft per county (state count)
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* ── List ── */}
        <Card>
          <CardHeader className="space-y-2 pb-2">
            <Input
              placeholder="Search name, address, owner, parcel…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Select
                value={county || "all"}
                onValueChange={(v) => setCounty(v === "all" ? "" : v)}
              >
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
          </CardHeader>
          <CardContent className="max-h-[70vh] space-y-1 overflow-y-auto p-2">
            {buildings.isLoading && <p className="p-2 text-xs text-muted-foreground">Loading…</p>}
            {buildings.data?.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">
                No prospects yet. Add a building, or pick one from the warranty leads.
              </p>
            )}
            {(buildings.data ?? []).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                  selectedId === b.id ? "bg-primary/15" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{buildingLine(b)}</span>
                </div>
                <div className="pl-6 text-xs text-muted-foreground">
                  {[b.county && `${b.county} Co.`, b.roof_sqft && `${num(b.roof_sqft)} sq ft roof`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

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
                      {form.id ? buildingLine(form as BuildingRow) : "New building"}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Entered by hand; the parcel ingest fills the rest later
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
                    {canWrite && (
                      <Button
                        size="sm"
                        onClick={() => save.mutate(form)}
                        disabled={save.isPending || (!form.name.trim() && !form.address1.trim())}
                      >
                        Save
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
