/**
 * Prospecting phase 1 — the Buildings page (docs/roofing-ops-portal-brief.md, MODULES.md).
 * A territory roof database you can use with nothing else in place: add a building by hand,
 * keep its roofs (what is up there, when we installed it, warranty clock) and follow-up
 * tasks, seed "own book" from accepted bids, and start a bid from a building. The map and
 * the parcel ingest come next; this page is what they populate.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Building2, CheckSquare, FilePlus2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { buildingLine, equivalentRectangle } from "@/lib/prospect";
import {
  deleteBuilding,
  deleteRoof,
  getBuilding,
  listBuildings,
  listCounties,
  listOpenTasks,
  saveBuilding,
  saveRoof,
  saveTask,
  seedOwnBook,
  setTaskDone,
  type BuildingInput,
  type BuildingRow,
  type RoofInput,
  type RoofRow,
} from "@/lib/prospect.functions";
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
  notes: null,
});

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
  const seedFn = useServerFn(seedOwnBook);
  const openTasksFn = useServerFn(listOpenTasks);

  const [q, setQ] = useState("");
  const [county, setCounty] = useState("");
  const [ownBook, setOwnBook] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(props.initialBuildingId ?? null);
  const [form, setForm] = useState<BuildingInput | null>(null);
  const [roofForm, setRoofForm] = useState<RoofInput | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");

  useEffect(() => {
    if (props.initialBuildingId) setSelectedId(props.initialBuildingId);
  }, [props.initialBuildingId]);

  const buildings = useQuery({
    queryKey: ["buildings", q, county, ownBook],
    queryFn: () =>
      listFn({
        data: {
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(county ? { county } : {}),
          ...(ownBook ? { ownBook: true } : {}),
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
  const seed = useMutation({
    mutationFn: () => seedFn(),
    onSuccess: (r) => {
      toast.success(
        r.created === 0
          ? "No accepted bids without a building"
          : `${r.created} building${r.created === 1 ? "" : "s"} added from accepted bids`,
      );
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
            The territory roof database: every roof we know about, ours and everyone else&apos;s.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && canBid && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => seed.mutate()}
              disabled={seed.isPending}
              title="Every accepted bid without a building becomes a building plus one roof per section"
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Seed own book from accepted bids
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
              <label className="flex items-center gap-1 text-xs">
                <Checkbox checked={ownBook} onCheckedChange={(v) => setOwnBook(v === true)} />
                Own book
              </label>
            </div>
          </CardHeader>
          <CardContent className="max-h-[70vh] space-y-1 overflow-y-auto p-2">
            {buildings.isLoading && <p className="p-2 text-xs text-muted-foreground">Loading…</p>}
            {buildings.data?.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">
                No buildings yet. Add one, or seed the own book from accepted bids.
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
                  {b.own_book && (
                    <span className="ml-auto rounded-full bg-emerald-500/15 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                      own book
                    </span>
                  )}
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
                <p>Select a building on the left, or add one.</p>
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
                      {detail.data?.building.source === "won_bid"
                        ? "Own book — created from an accepted bid"
                        : "Entered by hand; the parcel ingest fills the rest later"}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {form.id && canBid && (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/estimate" search={{ building: form.id }}>
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
                  <div className="flex items-end gap-2 pb-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!form.own_book}
                        disabled={!canWrite}
                        onCheckedChange={(v) => setF("own_book", v === true)}
                      />
                      Own book (we installed it)
                    </label>
                  </div>
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
                      <CardTitle className="text-sm">Roofs</CardTitle>
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
                        <p className="text-xs text-muted-foreground">No roofs recorded.</p>
                      )}
                      {detail.data.roofs.length > 0 && (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Section</TableHead>
                              <TableHead>Roof</TableHead>
                              <TableHead className="text-right">Sq ft</TableHead>
                              <TableHead>Installed</TableHead>
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
                                    notes: r.notes,
                                  })
                                }
                              >
                                <TableCell className="font-medium">{r.section_name}</TableCell>
                                <TableCell>{r.roof_system ?? r.roof_type ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {num(r.area_sqft)}
                                </TableCell>
                                <TableCell>{r.install_date ?? "—"}</TableCell>
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
                          <RoofField
                            label="Our system (if installed by us)"
                            value={roofForm.roof_system ?? ""}
                            onChange={(v) => setRoofForm({ ...roofForm, roof_system: v || null })}
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
                            label="Install date"
                            type="date"
                            value={roofForm.install_date ?? ""}
                            onChange={(v) => setRoofForm({ ...roofForm, install_date: v || null })}
                          />
                          <RoofField
                            label="Installer"
                            value={roofForm.installer ?? ""}
                            onChange={(v) => setRoofForm({ ...roofForm, installer: v || null })}
                          />
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
