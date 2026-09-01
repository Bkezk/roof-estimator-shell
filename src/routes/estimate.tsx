import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, AlertTriangle, Save, FileText } from "lucide-react";

import {
  getEngineAdminData,
  getAccessoryCatalog,
  getAccessoryLaborLookup,
  getNonDlCatalog,
  getMetalsCatalog,
} from "@/lib/engine.functions";
import { getBid, saveBid, getWarrantyData, getMarkupPresets } from "@/lib/bids.functions";
import {
  buildEstimateInputs,
  type BidInput,
  type BidSectionInput,
  type AccessoryLine,
  type NonDlLine,
  type ParapetInput,
  type CurbInput,
  type MetalLine,
} from "@/lib/engine/bid-builder";
import { computeEstimate } from "@/lib/engine/estimate";
import type { MarkupMode } from "@/lib/engine/money";
import {
  buildBidInput,
  emptyCustomer,
  markupTypeToMode,
  type CustomerInfo,
  type SavedBidState,
} from "@/lib/proposal-bid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export const Route = createFileRoute("/estimate")({
  head: () => ({ meta: [{ title: "Estimator — Bid-O-Matic" }] }),
  validateSearch: (s: Record<string, unknown>): { bid?: string } => {
    const b = s["bid"];
    return typeof b === "string" ? { bid: b } : {};
  },
  component: EstimatePage,
});

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const num = (v: string) => (v.trim() === "" || v === "-" ? 0 : Number(v)) || 0;

let seq = 1;
const newSection = (defaults: Partial<BidSectionInput> = {}): BidSectionInput => ({
  id: `s${seq++}`,
  name: `Section ${seq - 1}`,
  length: 100,
  width: 100,
  deckType: "Wood",
  thickness: 40,
  color: "White",
  fieldLap: 28,
  fastenerOc: 18,
  perimLengthFt: 0,
  cornerLengthFt: 0,
  enhancementWidthFt: 3,
  perimFastenerOc: 12,
  cornerFastenerOc: 6,
  underlaymentBoard: "",
  sheetSizeLabel: "1500 sf",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  ...defaults,
});

let pseq = 1;
const newParapet = (defaults: Partial<ParapetInput> = {}): ParapetInput => ({
  id: `p${pseq++}`,
  name: `Parapet ${pseq - 1}`,
  lengthFt: 50,
  heightBand: "",
  deckType: "Wood",
  predrill: false,
  canted: false,
  girthInches: 36,
  ...defaults,
});

let cseq = 1;
const newCurb = (defaults: Partial<CurbInput> = {}): CurbInput => ({
  id: `c${cseq++}`,
  name: `Curb ${cseq - 1}`,
  quantity: 1,
  widthIn: 24,
  lengthIn: 36,
  curbType: "",
  deckType: "Wood",
  ...defaults,
});

const MARKUP_LABELS: Record<MarkupMode, string> = {
  0: "% of cost",
  1: "$ / man-day",
  2: "Gross profit %",
};

function EstimatePage() {
  const getFn = useServerFn(getEngineAdminData);
  const getAccFn = useServerFn(getAccessoryCatalog);
  const getAccLaborFn = useServerFn(getAccessoryLaborLookup);
  const getNonDlFn = useServerFn(getNonDlCatalog);
  const getMetalsFn = useServerFn(getMetalsCatalog);
  const getWarrantyFn = useServerFn(getWarrantyData);
  const getPresetsFn = useServerFn(getMarkupPresets);
  const getBidFn = useServerFn(getBid);
  const saveBidFn = useServerFn(saveBid);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { bid: bidParam } = Route.useSearch();

  const { data: admin, isLoading } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getFn(),
  });
  const { data: accCatalog } = useQuery({
    queryKey: ["accessory-catalog"],
    queryFn: () => getAccFn(),
  });
  const { data: accLaborLookup } = useQuery({
    queryKey: ["accessory-labor-lookup"],
    queryFn: () => getAccLaborFn(),
  });
  const { data: nonDlCatalog } = useQuery({
    queryKey: ["nondl-catalog"],
    queryFn: () => getNonDlFn(),
  });
  const { data: metalsCatalog } = useQuery({
    queryKey: ["metals-catalog"],
    queryFn: () => getMetalsFn(),
  });
  const { data: warrantyData } = useQuery({
    queryKey: ["warranty-data"],
    queryFn: () => getWarrantyFn(),
  });
  const { data: presets } = useQuery({
    queryKey: ["markup-presets"],
    queryFn: () => getPresetsFn(),
  });

  const [roofSystem, setRoofSystem] = useState("Duro-Last");
  const [attachment, setAttachment] = useState<"mechanical" | "adhered">("mechanical");
  const [sections, setSections] = useState<BidSectionInput[]>([newSection()]);
  const [accessories, setAccessories] = useState<AccessoryLine[]>([]);
  const [nonDlLines, setNonDlLines] = useState<NonDlLine[]>([]);
  const [metals, setMetals] = useState<MetalLine[]>([]);
  const [parapets, setParapets] = useState<ParapetInput[]>([]);
  const [curbs, setCurbs] = useState<CurbInput[]>([]);
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer());
  const [markupMode, setMarkupMode] = useState<MarkupMode>(2);
  const [markup, setMarkup] = useState(35);
  const [laborRate, setLaborRate] = useState(50);
  const [commission, setCommission] = useState(3);
  const [taxExempt, setTaxExempt] = useState(false);
  const [prepayDiscount, setPrepayDiscount] = useState(false);
  const [stdSizeDiscount, setStdSizeDiscount] = useState(false);
  const [volumeDiscount, setVolumeDiscount] = useState(false);
  const [perDiem, setPerDiem] = useState(0);
  const [perDiemInMarkup, setPerDiemInMarkup] = useState(true);
  const [commissionInMarkup, setCommissionInMarkup] = useState(false);
  const [adjustLaborPct, setAdjustLaborPct] = useState(0);
  const [warrantyName, setWarrantyName] = useState("");
  const [highWind, setHighWind] = useState(false);
  const [highWindTermYears, setHighWindTermYears] = useState(0);
  const [highWindBand, setHighWindBand] = useState("");

  const applyPreset = (name: string) => {
    const p = presets?.find((x) => x.name === name);
    if (!p) return;
    setLaborRate(p.hourlyRate);
    setMarkup(p.markupAmount);
    const mode = markupTypeToMode(p.markupType);
    if (mode !== null) setMarkupMode(mode);
    setPerDiemInMarkup(p.includePerDiem);
    setCommissionInMarkup(p.includeCommission);
  };

  const [bidId, setBidId] = useState<string | undefined>(bidParam);
  const [bidName, setBidName] = useState("Untitled bid");
  const [saving, setSaving] = useState(false);

  // Load a saved bid when arriving with ?bid=<id>, and hydrate the form once.
  const { data: loadedBid } = useQuery({
    queryKey: ["bid", bidParam],
    queryFn: () => getBidFn({ data: { id: bidParam! } }),
    enabled: !!bidParam,
  });
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedBid || hydratedFor.current === loadedBid.id) return;
    const d = loadedBid.data as unknown as Partial<SavedBidState> | null;
    if (d && Array.isArray(d.sections)) {
      setRoofSystem(d.roofSystem ?? "Duro-Last");
      setAttachment(d.attachment ?? "mechanical");
      setSections(d.sections.length ? d.sections : [newSection()]);
      setAccessories(Array.isArray(d.accessories) ? d.accessories : []);
      setNonDlLines(Array.isArray(d.nonDlLines) ? d.nonDlLines : []);
      setMetals(Array.isArray(d.metals) ? d.metals : []);
      setParapets(Array.isArray(d.parapets) ? d.parapets : []);
      setCurbs(Array.isArray(d.curbs) ? d.curbs : []);
      setCustomer({ ...emptyCustomer(), ...(d.customer ?? {}) });
      setMarkupMode((d.markupMode ?? 2) as MarkupMode);
      setMarkup(d.markup ?? 35);
      setLaborRate(d.laborRate ?? 50);
      setCommission(d.commission ?? 3);
      setTaxExempt(d.taxExempt ?? false);
      setPrepayDiscount(d.prepayDiscount ?? false);
      setStdSizeDiscount(d.stdSizeDiscount ?? false);
      setVolumeDiscount(d.volumeDiscount ?? false);
      setPerDiem(d.perDiem ?? 0);
      setPerDiemInMarkup(d.perDiemInMarkup ?? true);
      setCommissionInMarkup(d.commissionInMarkup ?? false);
      setAdjustLaborPct(d.adjustLaborPct ?? 0);
      setWarrantyName(d.warrantyName ?? "");
      setHighWind(d.highWind ?? false);
      setHighWindTermYears(d.highWindTermYears ?? 0);
      setHighWindBand(d.highWindBand ?? "");
    }
    setBidId(loadedBid.id);
    setBidName(loadedBid.name);
    hydratedFor.current = loadedBid.id;
  }, [loadedBid]);

  const systemOptions = useMemo(() => {
    if (!admin) return [];
    return [...new Set(Object.keys(admin.labor).map((k) => k.split("|")[0]!))];
  }, [admin]);

  const comboKey = `${roofSystem}|${attachment === "adhered" ? "adhesive" : "mechanical"}`;
  const laborTable = admin?.labor[comboKey];
  const colorOptions = useMemo(() => {
    if (!admin) return ["White"];
    const set = new Set<string>();
    for (const byTier of Object.values(admin.priceMatrix)) {
      for (const byColor of Object.values(byTier ?? {})) {
        for (const c of Object.keys(byColor)) set.add(c);
      }
    }
    return set.size ? [...set] : ["White"];
  }, [admin]);
  const sheetSizeOptions = laborTable ? Object.keys(laborTable.sheetSizeMultiByLabel) : ["1500 sf"];
  const underlaymentOptions = ["None", ...Object.keys(admin?.underlaymentPrices ?? {})];
  const warrantyOptions = ["None", ...(warrantyData?.warranties.map((w) => w.name) ?? [])];
  const hwTerms = [...new Set(warrantyData?.highWind.map((h) => h.termYears) ?? [])].sort(
    (a, b) => a - b,
  );
  const hwBands = [...new Set(warrantyData?.highWind.map((h) => h.windBand) ?? [])];

  const saved: SavedBidState = {
    roofSystem,
    attachment,
    sections,
    accessories,
    nonDlLines,
    metals,
    parapets,
    curbs,
    customer,
    markupMode,
    markup,
    laborRate,
    commission,
    taxExempt,
    prepayDiscount,
    stdSizeDiscount,
    volumeDiscount,
    perDiem,
    perDiemInMarkup,
    commissionInMarkup,
    adjustLaborPct,
    warrantyName,
    highWind,
    highWindTermYears,
    highWindBand,
  };
  const bid: BidInput = buildBidInput(saved, warrantyData);

  const result = useMemo(() => {
    if (!admin) return null;
    const { inputs, warnings, parapetMaterial, metalsMaterial } = buildEstimateInputs(bid, admin);
    return { r: computeEstimate(inputs), warnings, parapetMaterial, metalsMaterial };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, JSON.stringify(bid)]);

  const accessoryTotal = accessories.reduce((sum, a) => sum + a.price * a.quantity, 0);
  const accessoryLaborHours = accessories.reduce(
    (sum, a) => sum + (a.laborHoursPerUnit ?? 0) * a.quantity,
    0,
  );
  const nonDlMaterialTotal = nonDlLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const nonDlLaborTotal = nonDlLines.reduce(
    (sum, l) => sum + l.laborPerUnit * l.laborRate * l.quantity,
    0,
  );
  const metalsLaborTotal = metals.reduce(
    (sum, m) => sum + m.laborPerUnit * m.laborRate * m.quantity,
    0,
  );

  const editSection = (i: number, patch: Partial<BidSectionInput>) =>
    setSections((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const handleSave = async () => {
    setSaving(true);
    try {
      const grandTotal = result?.r.money.grandTotal ?? 0;
      const row = await saveBidFn({
        data: {
          ...(bidId ? { id: bidId } : {}),
          name: bidName.trim() || "Untitled bid",
          data: saved as unknown as Record<string, unknown>,
          grandTotal,
        },
      });
      qc.invalidateQueries({ queryKey: ["bids"] });
      toast.success("Bid saved");
      if (row && !bidId) {
        setBidId(row.id);
        hydratedFor.current = row.id;
        void navigate({ to: "/estimate", search: { bid: row.id }, replace: true });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading pricing & labor…</p>;
  if (!admin) return <p className="text-sm text-muted-foreground">Could not load engine data.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Estimator</h1>
            <p className="text-sm text-muted-foreground">
              A live estimate — the bid total recomputes from the seeded pricing and labor data on
              every change.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Bid name</Label>
              <Input
                className="w-[220px]"
                value={bidName}
                onChange={(e) => setBidName(e.target.value)}
              />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : bidId ? "Save" : "Save bid"}
            </Button>
            <Button
              variant="outline"
              disabled={!bidId}
              title={bidId ? "Open the printable proposal" : "Save the bid first"}
              onClick={() => bidId && navigate({ to: "/proposal", search: { bid: bidId } })}
            >
              <FileText className="mr-2 h-4 w-4" />
              Proposal
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer &amp; project</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer name">
              <Input
                value={customer.name}
                onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
              />
            </Field>
            <Field label="Contact (phone / email)">
              <Input
                value={customer.contact}
                onChange={(e) => setCustomer((c) => ({ ...c, contact: e.target.value }))}
              />
            </Field>
            <Field label="Project address">
              <Input
                value={customer.projectAddress}
                onChange={(e) => setCustomer((c) => ({ ...c, projectAddress: e.target.value }))}
              />
            </Field>
            <Field label="Scope notes (optional, shown on the proposal)">
              <Input
                value={customer.notes}
                onChange={(e) => setCustomer((c) => ({ ...c, notes: e.target.value }))}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Roof system</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label className="text-xs">System</Label>
              <Select value={roofSystem} onValueChange={setRoofSystem}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {systemOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Attachment</Label>
              <Select
                value={attachment}
                onValueChange={(v) => setAttachment(v as "mechanical" | "adhered")}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mechanical">Mechanical</SelectItem>
                  <SelectItem value="adhered">Adhered</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Roof sections</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSections((p) => [...p, newSection()])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add section
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {sections.map((s, i) => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Input
                    className="h-8 w-[220px] font-medium"
                    value={s.name}
                    onChange={(e) => editSection(i, { name: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => setSections((p) => p.filter((_, j) => j !== i))}
                    disabled={sections.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  <Field label="Length (ft)">
                    <Input
                      type="number"
                      value={s.length}
                      onChange={(e) => editSection(i, { length: num(e.target.value) })}
                    />
                  </Field>
                  <Field label="Width (ft)">
                    <Input
                      type="number"
                      value={s.width}
                      onChange={(e) => editSection(i, { width: num(e.target.value) })}
                    />
                  </Field>
                  <Field label="Deck">
                    <PickOne
                      value={s.deckType}
                      options={admin.deckOrder}
                      onChange={(v) => editSection(i, { deckType: v })}
                    />
                  </Field>
                  <Field label="Thickness">
                    <PickOne
                      value={String(s.thickness)}
                      options={["40", "50", "60"]}
                      onChange={(v) => editSection(i, { thickness: Number(v) })}
                    />
                  </Field>
                  <Field label="Color">
                    <PickOne
                      value={s.color}
                      options={colorOptions}
                      onChange={(v) => editSection(i, { color: v })}
                    />
                  </Field>
                  <Field label="Avg sheet">
                    <PickOne
                      value={s.sheetSizeLabel}
                      options={sheetSizeOptions}
                      onChange={(v) => editSection(i, { sheetSizeLabel: v })}
                    />
                  </Field>
                  <Field label="Underlayment">
                    <PickOne
                      value={s.underlaymentBoard || "None"}
                      options={underlaymentOptions}
                      onChange={(v) => editSection(i, { underlaymentBoard: v === "None" ? "" : v })}
                    />
                  </Field>
                  <Field label="Tab lap (in)">
                    <Input
                      type="number"
                      value={s.fieldLap}
                      onChange={(e) => editSection(i, { fieldLap: num(e.target.value) })}
                    />
                  </Field>
                  <Field label="Fastener OC (in)">
                    <Input
                      type="number"
                      value={s.fastenerOc}
                      onChange={(e) => editSection(i, { fastenerOc: num(e.target.value) })}
                    />
                  </Field>
                </div>
                <div className="mt-3 border-t pt-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Perimeter / corner zones (leave length 0 to bill the whole section as field)
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <Field label="Perim len (ft)">
                      <Input
                        type="number"
                        value={s.perimLengthFt}
                        onChange={(e) => editSection(i, { perimLengthFt: num(e.target.value) })}
                      />
                    </Field>
                    <Field label="Corner len (ft)">
                      <Input
                        type="number"
                        value={s.cornerLengthFt}
                        onChange={(e) => editSection(i, { cornerLengthFt: num(e.target.value) })}
                      />
                    </Field>
                    <Field label="Zone width (ft)">
                      <Input
                        type="number"
                        value={s.enhancementWidthFt}
                        onChange={(e) =>
                          editSection(i, { enhancementWidthFt: num(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Perim OC (in)">
                      <Input
                        type="number"
                        value={s.perimFastenerOc}
                        onChange={(e) => editSection(i, { perimFastenerOc: num(e.target.value) })}
                      />
                    </Field>
                    <Field label="Corner OC (in)">
                      <Input
                        type="number"
                        value={s.cornerFastenerOc}
                        onChange={(e) => editSection(i, { cornerFastenerOc: num(e.target.value) })}
                      />
                    </Field>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`to-${s.id}`}
                      checked={s.tearOff}
                      onCheckedChange={(v) => editSection(i, { tearOff: v })}
                    />
                    <Label htmlFor={`to-${s.id}`} className="text-xs">
                      Tear-off
                    </Label>
                  </div>
                  {s.tearOff && (
                    <>
                      <Field label="Tear-off type">
                        <PickOne
                          value={s.tearOffType}
                          options={admin.tearOff?.tearoffTypes ?? []}
                          onChange={(v) => editSection(i, { tearOffType: v })}
                        />
                      </Field>
                      <Field label="Debris depth (in)">
                        <Input
                          type="number"
                          className="w-[120px]"
                          value={s.toThicknessInches}
                          onChange={(e) =>
                            editSection(i, { toThicknessInches: num(e.target.value) })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Parapets</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setParapets((p) => [
                  ...p,
                  newParapet({ heightBand: admin.parapetLabor?.bands[0] ?? "" }),
                ])
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add parapet
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {parapets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No parapet walls. Labor bills from the deck × wall-height matrix; membrane girth ×
                length prices at the bid's default membrane.
              </p>
            ) : (
              parapets.map((p, i) => (
                <div key={p.id} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <Input
                      className="h-8 w-[200px] font-medium"
                      value={p.name}
                      onChange={(e) =>
                        setParapets((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => setParapets((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <Field label="Length (ft)">
                      <Input
                        type="number"
                        value={p.lengthFt}
                        onChange={(e) =>
                          setParapets((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, lengthFt: num(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Wall height">
                      <PickOne
                        value={p.heightBand}
                        options={admin.parapetLabor?.bands ?? []}
                        onChange={(v) =>
                          setParapets((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, heightBand: v } : x)),
                          )
                        }
                      />
                    </Field>
                    <Field label="Deck">
                      <PickOne
                        value={p.deckType}
                        options={admin.deckOrder}
                        onChange={(v) =>
                          setParapets((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, deckType: v } : x)),
                          )
                        }
                      />
                    </Field>
                    <Field label="Membrane girth (in)">
                      <Input
                        type="number"
                        value={p.girthInches}
                        onChange={(e) =>
                          setParapets((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, girthInches: num(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <div className="flex items-end gap-2 pb-1">
                      <Switch
                        id={`pd-${p.id}`}
                        checked={p.predrill}
                        onCheckedChange={(v) =>
                          setParapets((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, predrill: v } : x)),
                          )
                        }
                      />
                      <Label htmlFor={`pd-${p.id}`} className="text-xs">
                        Pre-drill
                      </Label>
                    </div>
                    <div className="flex items-end gap-2 pb-1">
                      <Switch
                        id={`ct-${p.id}`}
                        checked={p.canted}
                        onCheckedChange={(v) =>
                          setParapets((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, canted: v } : x)),
                          )
                        }
                      />
                      <Label htmlFor={`ct-${p.id}`} className="text-xs">
                        Canted
                      </Label>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Curbs</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurbs((p) => [...p, newCurb({ curbType: admin.curbLabor?.curbTypes[0] ?? "" })])
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add curb
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {curbs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No curbs. Labor bills per curb: setup + minutes/LF for the deck × curb-type
                multiplier × perimeter.
              </p>
            ) : (
              curbs.map((c, i) => (
                <div key={c.id} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <Input
                      className="h-8 w-[200px] font-medium"
                      value={c.name}
                      onChange={(e) =>
                        setCurbs((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => setCurbs((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <Field label="Quantity">
                      <Input
                        type="number"
                        value={c.quantity}
                        onChange={(e) =>
                          setCurbs((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, quantity: num(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="A (in)">
                      <Input
                        type="number"
                        value={c.widthIn}
                        onChange={(e) =>
                          setCurbs((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, widthIn: num(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="B (in)">
                      <Input
                        type="number"
                        value={c.lengthIn}
                        onChange={(e) =>
                          setCurbs((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, lengthIn: num(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Type">
                      <PickOne
                        value={c.curbType}
                        options={admin.curbLabor?.curbTypes ?? []}
                        onChange={(v) =>
                          setCurbs((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, curbType: v } : x)),
                          )
                        }
                      />
                    </Field>
                    <Field label="Deck">
                      <PickOne
                        value={c.deckType}
                        options={admin.deckOrder}
                        onChange={(v) =>
                          setCurbs((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, deckType: v } : x)),
                          )
                        }
                      />
                    </Field>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Accessories</CardTitle>
            <Select
              value=""
              onValueChange={(key) => {
                const item = accCatalog?.find((a) => a.key === key);
                if (item) {
                  // Prefill labor from the base description (before the " — color" suffix), if known.
                  const baseDesc = item.variant
                    ? item.description.slice(0, -` — ${item.variant}`.length)
                    : item.description;
                  const laborHoursPerUnit = accLaborLookup?.[baseDesc] ?? 0;
                  setAccessories((p) => [
                    ...p,
                    {
                      description: `${item.category} — ${item.description}`,
                      price: item.price,
                      quantity: 1,
                      laborHoursPerUnit,
                    },
                  ]);
                }
              }}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Add accessory…" />
              </SelectTrigger>
              <SelectContent>
                {(accCatalog ?? []).map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.category} — {a.description} ({money(a.price)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {accessories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No accessories added.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-[80px]">Unit</TableHead>
                    <TableHead className="w-[90px]">Labor h/ea</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="w-[100px] text-right">Total</TableHead>
                    <TableHead className="w-[44px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accessories.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell>{a.description}</TableCell>
                      <TableCell>{money(a.price)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.0001"
                          className="h-8 w-[80px]"
                          value={a.laborHoursPerUnit ?? 0}
                          onChange={(e) =>
                            setAccessories((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, laborHoursPerUnit: num(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-[70px]"
                          value={a.quantity}
                          onChange={(e) =>
                            setAccessories((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, quantity: num(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(a.price * a.quantity)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => setAccessories((p) => p.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Metals</CardTitle>
            <Select
              value=""
              onValueChange={(key) => {
                const item = metalsCatalog?.find((m) => m.key === key);
                if (item)
                  setMetals((p) => [
                    ...p,
                    {
                      description: `${item.category} — ${item.description}`,
                      price: item.unitCost,
                      laborPerUnit: item.laborPerUnit,
                      laborRate: item.laborRate,
                      quantity: 1,
                    },
                  ]);
              }}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Add metals item…" />
              </SelectTrigger>
              <SelectContent>
                {(metalsCatalog ?? []).map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.category} — {m.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {metals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No metals. Gutters, downspouts, pitch pans, collection boxes — material folds into
                Duro-Last material; labor into Subs &amp; services.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-[80px]">Matl</TableHead>
                    <TableHead className="w-[80px]">Labor/ea</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="w-[100px] text-right">Total</TableHead>
                    <TableHead className="w-[44px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metals.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell>{m.description}</TableCell>
                      <TableCell>{money(m.price)}</TableCell>
                      <TableCell>{money(m.laborPerUnit * m.laborRate)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-[70px]"
                          value={m.quantity}
                          onChange={(e) =>
                            setMetals((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, quantity: num(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money((m.price + m.laborPerUnit * m.laborRate) * m.quantity)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => setMetals((p) => p.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Non-Duro-Last items</CardTitle>
            <Select
              value=""
              onValueChange={(key) => {
                const item = nonDlCatalog?.find((n) => n.key === key);
                if (item)
                  setNonDlLines((p) => [
                    ...p,
                    {
                      description: `${item.category} — ${item.description}`,
                      price: item.price,
                      laborPerUnit: item.laborPerUnit,
                      laborRate: item.laborRate,
                      quantity: 1,
                    },
                  ]);
              }}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Add non-DL item…" />
              </SelectTrigger>
              <SelectContent>
                {(nonDlCatalog ?? []).map((n) => (
                  <SelectItem key={n.key} value={n.key}>
                    {n.category} — {n.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {nonDlLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No non-DL items. Material folds into Other material; labor into Subs &amp; services.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-[80px]">Matl</TableHead>
                    <TableHead className="w-[80px]">Labor/ea</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="w-[100px] text-right">Total</TableHead>
                    <TableHead className="w-[44px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nonDlLines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.description}</TableCell>
                      <TableCell>{money(l.price)}</TableCell>
                      <TableCell>{money(l.laborPerUnit * l.laborRate)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-[70px]"
                          value={l.quantity}
                          onChange={(e) =>
                            setNonDlLines((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, quantity: num(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money((l.price + l.laborPerUnit * l.laborRate) * l.quantity)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => setNonDlLines((p) => p.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            {(presets?.length ?? 0) > 0 && (
              <Field label="Preset">
                <Select value="" onValueChange={applyPreset}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Apply preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(presets ?? []).map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Markup type">
              <Select
                value={String(markupMode)}
                onValueChange={(v) => setMarkupMode(Number(v) as MarkupMode)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {([0, 1, 2] as MarkupMode[]).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {MARKUP_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Markup value">
              <Input
                type="number"
                value={markup}
                onChange={(e) => setMarkup(num(e.target.value))}
              />
            </Field>
            <Field label="Labor $/hr">
              <Input
                type="number"
                value={laborRate}
                onChange={(e) => setLaborRate(num(e.target.value))}
              />
            </Field>
            <Field label="Commission %">
              <Input
                type="number"
                value={commission}
                onChange={(e) => setCommission(num(e.target.value))}
              />
            </Field>
            <Field label="Adjust labor %">
              <Input
                type="number"
                value={adjustLaborPct}
                onChange={(e) => setAdjustLaborPct(num(e.target.value))}
              />
            </Field>
            <Field label="Per-diem $/man-day">
              <Input
                type="number"
                value={perDiem}
                onChange={(e) => setPerDiem(num(e.target.value))}
              />
            </Field>
            <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 pt-1">
              <div className="flex items-center gap-2">
                <Switch id="taxex" checked={taxExempt} onCheckedChange={setTaxExempt} />
                <Label htmlFor="taxex" className="text-xs">
                  Tax exempt
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="pdim" checked={perDiemInMarkup} onCheckedChange={setPerDiemInMarkup} />
                <Label htmlFor="pdim" className="text-xs">
                  Per-diem in markup
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="commim"
                  checked={commissionInMarkup}
                  onCheckedChange={setCommissionInMarkup}
                />
                <Label htmlFor="commim" className="text-xs">
                  Commission in markup
                </Label>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-xs font-medium text-muted-foreground">Discounts:</span>
              <div className="flex items-center gap-2">
                <Switch
                  id="disc-prepay"
                  checked={prepayDiscount}
                  onCheckedChange={setPrepayDiscount}
                />
                <Label htmlFor="disc-prepay" className="text-xs">
                  Prepay (−5%)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="disc-std"
                  checked={stdSizeDiscount}
                  onCheckedChange={setStdSizeDiscount}
                />
                <Label htmlFor="disc-std" className="text-xs">
                  Standard sheet (−4%, ≥50k sf)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="disc-vol"
                  checked={volumeDiscount}
                  onCheckedChange={setVolumeDiscount}
                />
                <Label htmlFor="disc-vol" className="text-xs">
                  Volume (−5%, &gt;100k sf)
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Warranty</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <Field label="Warranty type">
              <PickOne
                value={warrantyName || "None"}
                options={warrantyOptions}
                onChange={(v) => setWarrantyName(v === "None" ? "" : v)}
              />
            </Field>
            <div className="flex items-center gap-2 pb-1">
              <Switch id="hw" checked={highWind} onCheckedChange={setHighWind} />
              <Label htmlFor="hw" className="text-xs">
                High wind
              </Label>
            </div>
            {highWind && (
              <>
                <Field label="Term (years)">
                  <PickOne
                    value={highWindTermYears ? String(highWindTermYears) : ""}
                    options={hwTerms.map(String)}
                    onChange={(v) => setHighWindTermYears(Number(v))}
                  />
                </Field>
                <Field label="Max wind (mph band)">
                  <PickOne
                    value={highWindBand}
                    options={hwBands}
                    onChange={(v) => setHighWindBand(v)}
                  />
                </Field>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bid total</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result?.warnings.length ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <div className="mb-1 flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> Check inputs
                </div>
                <ul className="list-inside list-disc space-y-0.5">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <Row
                    label="Membrane material"
                    v={money(
                      (result.r.money.dTotals[0] ?? 0) -
                        accessoryTotal -
                        result.parapetMaterial -
                        result.metalsMaterial,
                    )}
                  />
                  {result.parapetMaterial > 0 && (
                    <Row label="Parapet material" v={money(result.parapetMaterial)} />
                  )}
                  {result.metalsMaterial > 0 && (
                    <Row label="Metals material" v={money(result.metalsMaterial)} />
                  )}
                  {accessoryTotal > 0 && <Row label="Accessories" v={money(accessoryTotal)} />}
                  {(result.r.money.dTotals[6] ?? 0) > 0 && (
                    <Row label="Underlayment" v={money(result.r.money.dTotals[6] ?? 0)} />
                  )}
                  {nonDlMaterialTotal > 0 && (
                    <Row label="Other material (non-DL)" v={money(nonDlMaterialTotal)} />
                  )}
                  {result.r.money.dTotals[1]! +
                    result.r.money.dTotals[2]! +
                    result.r.money.dTotals[3]! <
                    0 && (
                    <Row
                      label="Discounts"
                      v={money(
                        result.r.money.dTotals[1]! +
                          result.r.money.dTotals[2]! +
                          result.r.money.dTotals[3]!,
                      )}
                    />
                  )}
                  {(result.r.money.dTotals[5] ?? 0) > 0 && (
                    <Row label="Warranty" v={money(result.r.money.dTotals[5] ?? 0)} />
                  )}
                  <Row label="Labor" v={money(result.r.laborSubtotal1)} />
                  {(nonDlLaborTotal > 0 || metalsLaborTotal > 0) && (
                    <Row label="Subs & services" v={money(result.r.laborSubtotal2)} />
                  )}
                  <Row label="Subtotal 1" v={money(result.r.money.subtotal1)} />
                  <Row
                    label={`Markup (${MARKUP_LABELS[markupMode]})`}
                    v={money(result.r.money.markupValue)}
                  />
                  <Row label="Subtotal 2" v={money(result.r.money.subtotal2)} />
                  <Row label="Commission" v={money(result.r.money.commissionValue)} />
                  {perDiem > 0 && !perDiemInMarkup && (
                    <Row label="Per-diem" v={money(result.r.money.dTotals[17] ?? 0)} />
                  )}
                  <Row label="Sales tax" v={money(result.r.money.salesTaxValue)} />
                  <TableRow className="font-semibold">
                    <TableCell>Bid total</TableCell>
                    <TableCell className="text-right">{money(result.r.money.grandTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
            {result && (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Membrane sq ft</span>
                  <span>{result.r.sqFtTotalMembrane.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Install hours</span>
                  <span>{result.r.installHours.toFixed(2)}</span>
                </div>
                {accessoryLaborHours > 0 && (
                  <div className="flex justify-between">
                    <span>Accessory hours</span>
                    <span>{accessoryLaborHours.toFixed(2)}</span>
                  </div>
                )}
                {result.r.parapetLaborHours > 0 && (
                  <div className="flex justify-between">
                    <span>Parapet hours</span>
                    <span>{result.r.parapetLaborHours.toFixed(2)}</span>
                  </div>
                )}
                {result.r.curbLaborHours > 0 && (
                  <div className="flex justify-between">
                    <span>Curb hours</span>
                    <span>{result.r.curbLaborHours.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Man-days</span>
                  <span>{result.r.money.totalManDays.toFixed(2)}</span>
                </div>
                {result.r.tearOffLaborHours > 0 && (
                  <div className="flex justify-between">
                    <span>Tear-off hours</span>
                    <span>{result.r.tearOffLaborHours.toFixed(2)}</span>
                  </div>
                )}
                {result.r.disposalUnits > 0 && (
                  <div className="flex justify-between">
                    <span>Disposal units</span>
                    <span>{result.r.disposalUnits}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function PickOne({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right">{v}</TableCell>
    </TableRow>
  );
}
