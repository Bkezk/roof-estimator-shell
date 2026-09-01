import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, AlertTriangle, Save } from "lucide-react";

import { getEngineAdminData } from "@/lib/engine.functions";
import { getBid, saveBid } from "@/lib/bids.functions";
import { buildEstimateInputs, type BidInput, type BidSectionInput } from "@/lib/engine/bid-builder";
import { computeEstimate } from "@/lib/engine/estimate";
import type { MarkupMode } from "@/lib/engine/money";
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

/** The persisted shape of a saved bid's estimator state. */
interface SavedBid {
  roofSystem: string;
  attachment: "mechanical" | "adhered";
  sections: BidSectionInput[];
  markupMode: MarkupMode;
  markup: number;
  laborRate: number;
  commission: number;
  taxExempt: boolean;
}

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
  sheetSizeLabel: "1500 sf",
  tearOff: false,
  toThicknessInches: 0,
  ...defaults,
});

const MARKUP_LABELS: Record<MarkupMode, string> = {
  0: "% of cost",
  1: "$ / man-day",
  2: "Gross profit %",
};

function EstimatePage() {
  const getFn = useServerFn(getEngineAdminData);
  const getBidFn = useServerFn(getBid);
  const saveBidFn = useServerFn(saveBid);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { bid: bidParam } = Route.useSearch();

  const { data: admin, isLoading } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getFn(),
  });

  const [roofSystem, setRoofSystem] = useState("Duro-Last");
  const [attachment, setAttachment] = useState<"mechanical" | "adhered">("mechanical");
  const [sections, setSections] = useState<BidSectionInput[]>([newSection()]);
  const [markupMode, setMarkupMode] = useState<MarkupMode>(2);
  const [markup, setMarkup] = useState(35);
  const [laborRate, setLaborRate] = useState(50);
  const [commission, setCommission] = useState(3);
  const [taxExempt, setTaxExempt] = useState(false);

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
    const d = loadedBid.data as unknown as Partial<SavedBid> | null;
    if (d && Array.isArray(d.sections)) {
      setRoofSystem(d.roofSystem ?? "Duro-Last");
      setAttachment(d.attachment ?? "mechanical");
      setSections(d.sections.length ? d.sections : [newSection()]);
      setMarkupMode((d.markupMode ?? 2) as MarkupMode);
      setMarkup(d.markup ?? 35);
      setLaborRate(d.laborRate ?? 50);
      setCommission(d.commission ?? 3);
      setTaxExempt(d.taxExempt ?? false);
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

  const bid: BidInput = {
    roofSystem,
    attachment,
    sections,
    markupMode,
    markup,
    crewLaborRatePerHour: laborRate,
    commission,
    commissionInMarkup: false,
    perDiem: 0,
    perDiemInMarkup: true,
    prepayDiscount: false,
    stdSizeDiscount: false,
    volumeDiscount: false,
    taxExempt,
    adjustLaborPct: 0,
    extraShipping: 0,
    subsCost: 0,
    servicesCost: 0,
    materialUnderlayment: 0,
    otherMaterial: 0,
    warrantyCostPerSqFt: 0,
    warrantyNonEliteMasterCharge: 0,
    warrantyIsHighWind: false,
    warrantyHighWindUpcharge: 0,
  };

  const result = useMemo(() => {
    if (!admin) return null;
    const { inputs, warnings } = buildEstimateInputs(bid, admin);
    return { r: computeEstimate(inputs), warnings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, JSON.stringify(bid)]);

  const editSection = (i: number, patch: Partial<BidSectionInput>) =>
    setSections((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved: SavedBid = {
        roofSystem,
        attachment,
        sections,
        markupMode,
        markup,
        laborRate,
        commission,
        taxExempt,
      };
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
          </div>
        </div>

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
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
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
            <div className="flex items-end gap-2 pb-1">
              <Switch id="taxex" checked={taxExempt} onCheckedChange={setTaxExempt} />
              <Label htmlFor="taxex" className="text-xs">
                Tax exempt
              </Label>
            </div>
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
                  <Row label="Membrane material" v={money(result.r.money.dTotals[0] ?? 0)} />
                  <Row label="Labor" v={money(result.r.laborSubtotal1)} />
                  <Row label="Subtotal 1" v={money(result.r.money.subtotal1)} />
                  <Row
                    label={`Markup (${MARKUP_LABELS[markupMode]})`}
                    v={money(result.r.money.markupValue)}
                  />
                  <Row label="Subtotal 2" v={money(result.r.money.subtotal2)} />
                  <Row label="Commission" v={money(result.r.money.commissionValue)} />
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
                <div className="flex justify-between">
                  <span>Man-days</span>
                  <span>{result.r.money.totalManDays.toFixed(2)}</span>
                </div>
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
