import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  AlertTriangle,
  Save,
  FileText,
  Copy,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import {
  getEngineAdminData,
  getAccessoryCatalog,
  getAccessoryLaborLookup,
  getNonDlCatalog,
  getMetalsCatalog,
  getFastenerLookup,
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
  type UnderlaymentLayer,
  sectionLayers,
} from "@/lib/engine/bid-builder";
import { computeEstimate, computeSectionInstallHours } from "@/lib/engine/estimate";
import {
  universalFastenerSpacing,
  LEGACY_ROOF_SYSTEM_IDS,
  DESIGN_TABLE_OPTIONS,
  type SpacingError,
} from "@/lib/engine/fastener-spacing";
import { computeNeededQuantities, allowedScrewSubtypes } from "@/lib/engine/consumption";
import type { MarkupMode } from "@/lib/engine/money";
import {
  defaultEdges,
  perimeterFromEdges,
  summarizeEdges,
  TERMINATION_OPTIONS,
  ARP_SIZE_OPTIONS,
  type EdgeInput,
} from "@/lib/engine/edges";
import { SectionCalcDialog } from "@/components/section-calc-dialog";
import {
  buildBidInput,
  emptyCustomer,
  markupTypeToMode,
  resolveBidComputeData,
  type CustomerInfo,
  type SavedBidState,
  type WarrantyData,
} from "@/lib/proposal-bid";
import type { EngineAdminData } from "@/lib/engine/adapters";
import { BID_STATUSES, STATUS_LABELS, asBidStatus, type BidStatus } from "@/lib/bid-status";
import { useAuth } from "@/lib/auth-context";
import { buildReviewRows, toCsv } from "@/lib/review-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

let seq = 1;
const newSection = (defaults: Partial<BidSectionInput> = {}): BidSectionInput => ({
  id: `s${seq++}`,
  name: `Section ${seq - 1}`,
  length: 100,
  width: 100,
  deckType: "Wood",
  thickness: 40,
  color: "White",
  // Legacy XML default section: sheetsizeid 4 ("1500 sf") with tab 60.
  fieldLap: 60,
  fastenerOc: 18,
  perimLengthFt: 0,
  cornerLengthFt: 0,
  enhancementWidthFt: 3,
  perimFastenerOc: 12,
  cornerFastenerOc: 6,
  underlaymentBoard: "",
  layers: [],
  sheetSizeLabel: "1500 sf",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  // Legacy XML section defaults: Pull Test 350 lbs, Design Table 60 psf.
  pullTest: 350,
  designTable: 60,
  ...defaults,
});

// Selectable Field Tab Spacing pitches per system (legacy RSSheetTabSpacing + MechTabMulti;
// systems not listed keep a free numeric input).
const TAB_OPTIONS_BY_SYSTEM: Record<string, number[]> = {
  "Duro-Last": [28, 60, 120],
  "Duro-Roof": [57, 87, 120],
  "Duro-Tuff": [30, 60, 120],
};

let pseq = 1;
const newParapet = (defaults: Partial<ParapetInput> = {}): ParapetInput => ({
  id: `p${pseq++}`,
  name: `Parapet ${pseq - 1}`,
  lengthFt: 50,
  heightBand: "",
  deckType: "Wood",
  predrill: false,
  canted: false,
  // Legacy wall profile dims (in); girth = their sum. Defaults keep the prior 36" girth.
  skirtInches: 0,
  cantInches: 0,
  verticalInches: 24,
  wallTopInches: 12,
  dropInches: 0,
  girthInches: 36,
  // Legacy Pieces (membrane pieces wrapping the wall): AdjustedLength = length + 1 + pieces.
  pieces: 1,
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

/** The legacy ribbon, modernized: one screen per step with Previous / Next. */
const STEPS = [
  { key: "setup", label: "Setup" },
  { key: "sections", label: "Sections" },
  { key: "parapets", label: "Parapets" },
  { key: "curbs", label: "Curbs" },
  { key: "accessories", label: "Accessories" },
  { key: "metals", label: "Metals" },
  { key: "nondl", label: "Non-DL" },
  { key: "pricing", label: "Pricing & Warranty" },
  { key: "review", label: "Review" },
] as const;

function EstimatePage() {
  const getFn = useServerFn(getEngineAdminData);
  const getAccFn = useServerFn(getAccessoryCatalog);
  const getAccLaborFn = useServerFn(getAccessoryLaborLookup);
  const getNonDlFn = useServerFn(getNonDlCatalog);
  const getMetalsFn = useServerFn(getMetalsCatalog);
  const getFastenerLookupFn = useServerFn(getFastenerLookup);
  const getWarrantyFn = useServerFn(getWarrantyData);
  const getPresetsFn = useServerFn(getMarkupPresets);
  const getBidFn = useServerFn(getBid);
  const saveBidFn = useServerFn(saveBid);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { bid: bidParam } = Route.useSearch();
  // Gate every authed fetch on a live session: without one the server fns 401 (e.g. a mobile
  // browser whose token expired while backgrounded); AuthGate redirects to /login.
  const { session } = useAuth();
  const authed = !!session;

  const { data: liveAdmin, isLoading } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getFn(),
    enabled: authed,
  });
  const { data: accCatalog } = useQuery({
    queryKey: ["accessory-catalog"],
    queryFn: () => getAccFn(),
    enabled: authed,
  });
  const { data: accLaborLookup } = useQuery({
    queryKey: ["accessory-labor-lookup"],
    queryFn: () => getAccLaborFn(),
    enabled: authed,
  });
  const { data: nonDlCatalog } = useQuery({
    queryKey: ["nondl-catalog"],
    queryFn: () => getNonDlFn(),
    enabled: authed,
  });
  const { data: metalsCatalog } = useQuery({
    queryKey: ["metals-catalog"],
    queryFn: () => getMetalsFn(),
    enabled: authed,
  });
  const { data: liveWarrantyData } = useQuery({
    queryKey: ["warranty-data"],
    queryFn: () => getWarrantyFn(),
    enabled: authed,
  });
  const { data: presets } = useQuery({
    queryKey: ["markup-presets"],
    queryFn: () => getPresetsFn(),
    enabled: authed,
  });
  const { data: fastenerLookup } = useQuery({
    queryKey: ["fastener-lookup"],
    queryFn: () => getFastenerLookupFn(),
    enabled: authed,
  });

  // Frozen pricing (legacy "Update Pricing & Labor"): a saved bid carries a snapshot of the admin
  // + warranty data, captured at first save. All compute/options below resolve through it — admin
  // changes never touch this bid until the estimator explicitly updates the snapshot.
  const [snapshot, setSnapshot] = useState<{
    admin: EngineAdminData;
    warranty: WarrantyData | null;
    asOf: string;
  } | null>(null);
  const {
    admin,
    warranty: warrantyData,
    frozenAsOf,
  } = resolveBidComputeData(
    snapshot
      ? {
          adminSnapshot: snapshot.admin,
          ...(snapshot.warranty ? { warrantySnapshot: snapshot.warranty } : {}),
          pricingAsOf: snapshot.asOf,
        }
      : {},
    liveAdmin,
    liveWarrantyData,
  );

  const refreshPricing = async () => {
    try {
      const [a, w] = await Promise.all([getFn(), getWarrantyFn()]);
      setSnapshot({ admin: a, warranty: w ?? null, asOf: new Date().toISOString() });
      toast.success("Updated to current pricing & labor — totals recomputed. Save to keep it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not fetch current pricing");
    }
  };

  const [roofSystem, setRoofSystem] = useState("Duro-Last");
  const [attachment, setAttachment] = useState<"mechanical" | "adhered">("mechanical");
  const [membraneAdhesive, setMembraneAdhesive] = useState("Water Based Adhesive");
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
  const [adjustSetupPct, setAdjustSetupPct] = useState(0);
  const [adjustInspectionPct, setAdjustInspectionPct] = useState(0);
  const [laborTemplateName, setLaborTemplateName] = useState("");
  const [warrantyName, setWarrantyName] = useState("");
  // Legacy Home > Defaults panel: material defaults for NEW roof sections.
  const [sectionDefaults, setSectionDefaults] = useState({
    deckType: "Wood",
    thickness: 40,
    color: "White",
    sheetSizeLabel: "1500 sf",
  });
  const [selSection, setSelSection] = useState(0);
  const [selParapet, setSelParapet] = useState(0);
  const [selCurb, setSelCurb] = useState(0);
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
  const [bidStatus, setBidStatus] = useState<BidStatus>("draft");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  // Load a saved bid when arriving with ?bid=<id>, and hydrate the form once.
  const { data: loadedBid } = useQuery({
    queryKey: ["bid", bidParam],
    queryFn: () => getBidFn({ data: { id: bidParam! } }),
    enabled: authed && !!bidParam,
  });
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedBid || hydratedFor.current === loadedBid.id) return;
    const d = loadedBid.data as unknown as Partial<SavedBidState> | null;
    if (d && Array.isArray(d.sections)) {
      setRoofSystem(d.roofSystem ?? "Duro-Last");
      setAttachment(d.attachment ?? "mechanical");
      setMembraneAdhesive(d.membraneAdhesiveName ?? "Water Based Adhesive");
      setSections(
        d.sections.length
          ? d.sections.map((s) => ({ ...s, layers: sectionLayers(s) }))
          : [newSection()],
      );
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
      setAdjustSetupPct(d.adjustSetupPct ?? 0);
      setAdjustInspectionPct(d.adjustInspectionPct ?? 0);
      setLaborTemplateName(d.laborTemplateName ?? "");
      setWarrantyName(d.warrantyName ?? "");
      if (d.sectionDefaults) setSectionDefaults({ ...d.sectionDefaults });
      setHighWind(d.highWind ?? false);
      setHighWindTermYears(d.highWindTermYears ?? 0);
      setHighWindBand(d.highWindBand ?? "");
      setSnapshot(
        d.adminSnapshot
          ? {
              admin: d.adminSnapshot,
              warranty: d.warrantySnapshot ?? null,
              asOf: d.pricingAsOf ?? loadedBid.updated_at,
            }
          : null,
      );
    }
    setBidId(loadedBid.id);
    setBidName(loadedBid.name);
    setBidStatus(asBidStatus(loadedBid.status));
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
  const boardOptions = Object.keys(admin?.underlaymentPrices ?? {});
  const fastenerOptions = admin?.underlaymentLabor?.fastenerCounts ?? [5];
  const adhesiveOptions = admin?.adhesiveTimes?.adhesives ?? [];
  const substratesFor = (adhesive: string) =>
    Object.keys(admin?.adhesiveTimes?.bySubstrate[adhesive] ?? {});
  const warrantyOptions = ["None", ...(warrantyData?.warranties.map((w) => w.name) ?? [])];
  const laborTemplateOptions = ["None", ...(admin?.laborTemplates?.names ?? [])];
  const hwTerms = [...new Set(warrantyData?.highWind.map((h) => h.termYears) ?? [])].sort(
    (a, b) => a - b,
  );
  const hwBands = [...new Set(warrantyData?.highWind.map((h) => h.windBand) ?? [])];

  const saved: SavedBidState = {
    roofSystem,
    attachment,
    membraneAdhesiveName: membraneAdhesive,
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
    adjustSetupPct,
    adjustInspectionPct,
    laborTemplateName,
    sectionDefaults,
    warrantyName,
    highWind,
    highWindTermYears,
    highWindBand,
  };
  const bid: BidInput = buildBidInput(saved, warrantyData);

  const result = useMemo(() => {
    if (!admin) return null;
    const { inputs, warnings, parapetMaterial, metalsMaterial, adhesiveMaterial } =
      buildEstimateInputs(bid, admin);
    return {
      r: computeEstimate(inputs),
      // Per-section install hours (legacy per-section Man Hours); inputs.sections is
      // built 1:1 in order from bid.sections.
      sectionHours: inputs.sections.map((rs) =>
        computeSectionInstallHours(rs, inputs.admin, inputs.formulasVersion, inputs.adjustLaborPct),
      ),
      warnings,
      parapetMaterial,
      metalsMaterial,
      adhesiveMaterial,
      // Own-rate direct-labor hours (metals + categorized non-DL); they join man-days but are
      // priced at each line's own rate, so they aren't in any crew-rate hour bucket.
      ownRateHours: inputs.ownRateDirectLaborHours ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, JSON.stringify(bid)]);

  // Legacy red "needed" quantities (§2 consumption rules; display-only ordering guidance).
  const neededQty = useMemo(
    () =>
      computeNeededQuantities({
        sections,
        parapets,
        attachment,
        roofSystem,
        adhesiveCoverage: admin?.adhesiveTimes?.bySubstrate,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(sections), JSON.stringify(parapets), attachment, roofSystem, admin],
  );
  const enteredQty = useMemo(() => {
    let screws = 0;
    let polyPlates = 0;
    let insulationPlates = 0;
    let caulk = 0;
    // Legacy §2.6: a fastener line counts toward the screw bucket only when its SUBTYPE is
    // allowed for a deck present in the bid (bits/tips/stainless/etc. never count).
    const allowed = allowedScrewSubtypes([
      ...sections.map((s) => s.deckType),
      ...parapets.map((p) => p.deckType),
    ]);
    for (const line of accessories) {
      const item = accCatalog?.find((a) => `${a.category} — ${a.description}` === line.description);
      if (!item) continue;
      if (item.category.includes("Fasteners") && item.fastenersPerBox) {
        const d = item.description;
        if (d.includes("Poly Plates")) polyPlates += line.quantity * item.fastenersPerBox;
        else if (d.includes("Insulation Plates"))
          insulationPlates += line.quantity * item.fastenersPerBox;
        else if (d.includes("Plates") || d.includes("Cleat")) {
          // other plate rows (induction/cleat) — not netted against a bucket yet
        } else if (allowed.has((item.subtype ?? "").toLowerCase())) {
          screws += line.quantity * item.fastenersPerBox;
        }
      } else if (item.category.includes("Sealant") && item.description.startsWith("Duro-Caulk")) {
        caulk += line.quantity;
      }
    }
    return { screws, polyPlates, insulationPlates, caulk };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accessories,
    accCatalog,
    JSON.stringify(sections.map((s) => s.deckType)),
    JSON.stringify(parapets.map((p) => p.deckType)),
  ]);

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

  // Ordering summary (display-only): termination/blocking footage and ARP from the edge
  // definitions, plus insulation board / fastener / adhesive-unit counts from the known rules
  // (4×8 board = 32 sf; fasteners = count/32 × area; adhesive units = area ÷ coverage).
  const edgeSummary = summarizeEdges(sections.map((s) => s.edges ?? []));
  let insulationBoards = 0;
  let insulationFasteners = 0;
  const adhesiveUnitTotals: Record<string, number> = {};
  for (const s of sections) {
    const area = s.length * s.width;
    for (const layer of sectionLayers(s)) {
      if (layer.attachment === "mechanical") {
        insulationBoards += Math.ceil(area / 32);
        const count = layer.fastenersPerBoard > 0 ? layer.fastenersPerBoard : 5;
        insulationFasteners += Math.ceil((count / 32) * area);
      } else {
        const entry = admin?.adhesiveTimes?.bySubstrate[layer.adhesiveName]?.[layer.substrate];
        if (entry && entry.coverageSqFt > 0) {
          adhesiveUnitTotals[layer.adhesiveName] =
            (adhesiveUnitTotals[layer.adhesiveName] ?? 0) + area / entry.coverageSqFt;
        }
      }
    }
  }
  const hasOrderingSummary =
    edgeSummary.terminations.length > 0 ||
    edgeSummary.blockingFt > 0 ||
    edgeSummary.arpSqFtTotal > 0 ||
    insulationBoards > 0 ||
    Object.keys(adhesiveUnitTotals).length > 0;

  const editSection = (i: number, patch: Partial<BidSectionInput>) =>
    setSections((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  // Legacy pull-test autofill (§1): when the section has a pull test entered, re-derive the
  // field/perim/corner o.c. from MechFastenerLookup whenever a lookup key changes. Manual OC
  // edits still stick — the lookup only fires from pull-test / design-table / lap / thickness
  // changes, exactly like the legacy screen.
  const editSectionWithSpacing = (
    i: number,
    s: BidSectionInput,
    patch: Partial<BidSectionInput>,
  ) => {
    const next = { ...s, ...patch };
    const rsId = LEGACY_ROOF_SYSTEM_IDS[roofSystem];
    if (
      !fastenerLookup?.length ||
      !rsId ||
      attachment !== "mechanical" ||
      !next.pullTest ||
      next.pullTest <= 0
    ) {
      editSection(i, patch);
      return;
    }
    const base = {
      roofSystemId: rsId,
      thickness: next.thickness,
      designTable: next.designTable ?? 60,
      tabSpacings: [next.fieldLap],
      pullTest: next.pullTest,
    };
    const field = universalFastenerSpacing(fastenerLookup, { ...base, columnOffset: 0 });
    const perim = universalFastenerSpacing(fastenerLookup, { ...base, columnOffset: 1 });
    const corner = universalFastenerSpacing(fastenerLookup, { ...base, columnOffset: 2 });
    editSection(i, {
      ...patch,
      ...(field.ok ? { fastenerOc: field.inches } : {}),
      ...(perim.ok ? { perimFastenerOc: perim.inches } : {}),
      ...(corner.ok ? { cornerFastenerOc: corner.inches } : {}),
    });
  };

  const SPACING_ERROR_TEXT: Record<SpacingError, string> = {
    [-5]: "no lookup rows for this system/thickness",
    [-1]: "no rows for this design table",
    [-2]: "no rows for this tab spacing",
    [-3]: "pull test too low — no permitted spacing",
  };

  // Legacy-style stepped workflow: one screen per tab with Previous / Next, like the
  // Bid-Advantage ribbon. Steps stay mounted (hidden) so nothing is lost when switching.
  const goStep = (i: number) => {
    setStep(Math.min(STEPS.length - 1, Math.max(0, i)));
    window.scrollTo(0, 0);
  };
  const stepCount = (key: string): number | null => {
    switch (key) {
      case "sections":
        return sections.length;
      case "parapets":
        return parapets.length;
      case "curbs":
        return curbs.length;
      case "accessories":
        return accessories.length;
      case "metals":
        return metals.length;
      case "nondl":
        return nonDlLines.length;
      default:
        return null;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const grandTotal = result?.r.money.grandTotal ?? 0;
      // First save freezes the current pricing & labor into the bid; later saves keep the
      // existing snapshot untouched (only "Update pricing & labor" replaces it).
      const snap =
        snapshot ??
        (liveAdmin
          ? { admin: liveAdmin, warranty: liveWarrantyData ?? null, asOf: new Date().toISOString() }
          : null);
      const payload: SavedBidState = {
        ...saved,
        ...(snap
          ? {
              adminSnapshot: snap.admin,
              ...(snap.warranty ? { warrantySnapshot: snap.warranty } : {}),
              pricingAsOf: snap.asOf,
            }
          : {}),
      };
      const row = await saveBidFn({
        data: {
          ...(bidId ? { id: bidId } : {}),
          name: bidName.trim() || "Untitled bid",
          data: payload as unknown as Record<string, unknown>,
          grandTotal,
          status: bidStatus,
        },
      });
      qc.invalidateQueries({ queryKey: ["bids"] });
      toast.success("Bid saved");
      if (!snapshot && snap) setSnapshot(snap);
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

  // Estimate Review export (legacy "Export To Excel"): the same figures as the Bid-total panel,
  // as a CSV download the spreadsheet apps open directly.
  const exportReview = () => {
    if (!result) return;
    const d = result.r.money.dTotals;
    const rows = buildReviewRows({
      bidName: bidName.trim() || "Untitled bid",
      statusLabel: STATUS_LABELS[bidStatus],
      membraneMaterial:
        (d[0] ?? 0) -
        accessoryTotal -
        result.parapetMaterial -
        result.metalsMaterial -
        result.adhesiveMaterial,
      parapetMaterial: result.parapetMaterial,
      metalsMaterial: result.metalsMaterial,
      adhesiveMaterial: result.adhesiveMaterial,
      accessoryMaterial: accessoryTotal,
      underlaymentMaterial: d[6] ?? 0,
      otherMaterial: d[7] ?? 0,
      // Applied discounts only (d[4]−d[0]); d[1..3] are candidates computed regardless of toggles.
      discounts: (d[4] ?? 0) - (d[0] ?? 0),
      warrantyCost: d[5] ?? 0,
      shipping: d[9] ?? 0,
      laborCost: result.r.laborSubtotal1,
      subsServices: result.r.laborSubtotal2,
      subtotal1: result.r.money.subtotal1,
      markupLabel: MARKUP_LABELS[markupMode],
      markupValue: result.r.money.markupValue,
      subtotal2: result.r.money.subtotal2,
      commissionValue: result.r.money.commissionValue,
      perDiemCharge: perDiemInMarkup ? 0 : (d[17] ?? 0),
      salesTaxValue: result.r.money.salesTaxValue,
      grandTotal: result.r.money.grandTotal,
      installHours: result.r.installHours,
      setupHours: result.r.setupHours,
      inspectionHours: result.r.inspectionHours,
      tearOffHours: result.r.tearOffLaborHours,
      accessoryHours: accessoryLaborHours,
      parapetHours: result.r.parapetLaborHours,
      curbHours: result.r.curbLaborHours,
      underlaymentHours: result.r.underlaymentLaborHours,
      ownRateHours: result.ownRateHours,
      totalManDays: result.r.money.totalManDays,
      disposalUnits: result.r.disposalUnits,
      roofSqFt: sections.reduce((sum, s) => sum + s.length * s.width, 0),
      membraneSqFt: result.r.sqFtTotalMembrane,
    });
    // UTF-8 BOM so Excel opens it with the right encoding.
    const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(bidName.trim() || "estimate").replace(/[^\w.-]+/g, "_")}-review.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading && !snapshot)
    return <p className="text-sm text-muted-foreground">Loading pricing & labor…</p>;
  if (!admin) return <p className="text-sm text-muted-foreground">Could not load engine data.</p>;

  return (
    <div className="grid gap-6 pb-16 lg:grid-cols-[1fr_320px] lg:pb-0">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Estimator</h1>
            <p className="text-sm text-muted-foreground">
              A live estimate — the bid total recomputes from the seeded pricing and labor data on
              every change.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Bid name</Label>
              <Input
                className="w-[220px] max-w-full"
                value={bidName}
                onChange={(e) => setBidName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={bidStatus} onValueChange={(v) => setBidStatus(v as BidStatus)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BID_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button
              variant="outline"
              disabled={!result}
              title="Download the estimate review (cost, labor and unit metrics) as CSV"
              onClick={exportReview}
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {frozenAsOf !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>
              Pricing &amp; labor frozen as of{" "}
              {frozenAsOf ? new Date(frozenAsOf).toLocaleString() : "when this bid was saved"} —
              admin changes don't affect this bid until you update it.
            </span>
            <Button variant="outline" size="sm" onClick={refreshPricing}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Update pricing &amp; labor
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-1 rounded-md border bg-muted/40 p-1">
          {STEPS.map((st, i) => {
            const n = stepCount(st.key);
            return (
              <button
                key={st.key}
                type="button"
                onClick={() => goStep(i)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  step === i
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {st.label}
                {n !== null && n > 0 ? ` (${n})` : ""}
              </button>
            );
          })}
        </div>

        <div className={step === 0 ? "grid items-start gap-4 xl:grid-cols-2" : "hidden"}>
          {/* Legacy Home: "Setup" panel (Bid Info | Client | Job Site) on the left,
            "Defaults" panel on the right. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Setup</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="bidinfo">
                <TabsList>
                  <TabsTrigger value="bidinfo">Bid Info</TabsTrigger>
                  <TabsTrigger value="client">Client</TabsTrigger>
                  <TabsTrigger value="jobsite">Job Site</TabsTrigger>
                </TabsList>
                <TabsContent value="bidinfo" className="space-y-3 pt-2">
                  <LegacyGroup title="1. General Info">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Customer name">
                        <Input
                          value={customer.name}
                          onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                        />
                      </Field>
                      <Field label="Job name">
                        <Input value={bidName} onChange={(e) => setBidName(e.target.value)} />
                      </Field>
                      <Field label="Estimator's name">
                        <Input
                          value={customer.estimatorName ?? ""}
                          onChange={(e) =>
                            setCustomer((c) => ({ ...c, estimatorName: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label="Status">
                        <Select
                          value={bidStatus}
                          onValueChange={(v) => setBidStatus(asBidStatus(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BID_STATUSES.map((st) => (
                              <SelectItem key={st} value={st}>
                                {STATUS_LABELS[st]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Date created">
                        <Input
                          value={new Date(
                            (loadedBid as { created_at?: string } | null | undefined)?.created_at ??
                              Date.now(),
                          ).toLocaleDateString()}
                          disabled
                        />
                      </Field>
                    </div>
                  </LegacyGroup>
                  <LegacyGroup title="2. Labor &amp; Markup Setup">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span>
                        Labor:{" "}
                        <span className="font-semibold">${laborRate.toFixed(2)} per hour</span>
                      </span>
                      <span>
                        Markup:{" "}
                        <span className="font-semibold">
                          {markup}% ({MARKUP_LABELS[markupMode]})
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goStep(STEPS.findIndex((st) => st.key === "pricing"))}
                      >
                        Click here to edit
                      </Button>
                    </div>
                  </LegacyGroup>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LegacyGroup title="3. Labor Template">
                      <PickOne
                        value={laborTemplateName || "None"}
                        options={laborTemplateOptions}
                        onChange={(v) => setLaborTemplateName(v === "None" ? "" : v)}
                      />
                    </LegacyGroup>
                    <LegacyGroup title="4. Estimator Commission">
                      <Field label="Commission rate (%)">
                        <Input
                          type="number"
                          step="0.1"
                          value={commission}
                          onChange={(e) => setCommission(num(e.target.value))}
                        />
                      </Field>
                    </LegacyGroup>
                  </div>
                  <LegacyGroup title="5. Tax Exempt">
                    <div className="flex flex-wrap items-center gap-2">
                      <Switch
                        id="setup-taxexempt"
                        checked={taxExempt}
                        onCheckedChange={setTaxExempt}
                      />
                      <Label htmlFor="setup-taxexempt" className="text-xs">
                        Tax exempt
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Sales-tax rate &amp; only-tax-material come from Admin › General.
                      </span>
                    </div>
                  </LegacyGroup>
                  <LegacyGroup title="6. Notes">
                    <Textarea
                      rows={3}
                      placeholder="Shown on the proposal…"
                      value={customer.notes}
                      onChange={(e) => setCustomer((c) => ({ ...c, notes: e.target.value }))}
                    />
                  </LegacyGroup>
                </TabsContent>
                <TabsContent value="client" className="pt-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Contact person">
                      <Input
                        value={customer.contact}
                        onChange={(e) => setCustomer((c) => ({ ...c, contact: e.target.value }))}
                      />
                    </Field>
                    <Field label="Phone">
                      <Input
                        value={customer.phone ?? ""}
                        onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
                      />
                    </Field>
                    <Field label="E-mail">
                      <Input
                        value={customer.email ?? ""}
                        onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))}
                      />
                    </Field>
                    <Field label="Client address (street, city/st/zip)">
                      <Input
                        value={customer.clientAddress ?? ""}
                        onChange={(e) =>
                          setCustomer((c) => ({ ...c, clientAddress: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                </TabsContent>
                <TabsContent value="jobsite" className="space-y-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() =>
                      setCustomer((c) => ({ ...c, projectAddress: c.clientAddress ?? "" }))
                    }
                  >
                    <Copy className="mr-1 h-3 w-3" /> Copy client address
                  </Button>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Project address (street)">
                      <Input
                        value={customer.projectAddress}
                        onChange={(e) =>
                          setCustomer((c) => ({ ...c, projectAddress: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="City / St. / Zip">
                      <Input
                        value={customer.jobCityStZip ?? ""}
                        onChange={(e) =>
                          setCustomer((c) => ({ ...c, jobCityStZip: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Job #">
                      <Input
                        value={customer.jobNumber ?? ""}
                        onChange={(e) => setCustomer((c) => ({ ...c, jobNumber: e.target.value }))}
                      />
                    </Field>
                    <Field label="Ship via">
                      <Input
                        value={customer.shipVia ?? ""}
                        onChange={(e) => setCustomer((c) => ({ ...c, shipVia: e.target.value }))}
                      />
                    </Field>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Defaults</CardTitle>
              <CardDescription>
                Used when adding new roof sections; existing sections keep their values unless you
                apply.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <LegacyGroup title="1. Deck Type">
                <PickOne
                  value={sectionDefaults.deckType}
                  options={admin.deckOrder}
                  onChange={(v) => setSectionDefaults((p) => ({ ...p, deckType: v }))}
                />
              </LegacyGroup>
              <LegacyGroup title="2. Roof Sections Material">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Roof system">
                    <Select value={roofSystem} onValueChange={setRoofSystem}>
                      <SelectTrigger>
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
                  </Field>
                  <Field label="Attached with">
                    <Select
                      value={attachment}
                      onValueChange={(v) => setAttachment(v as "mechanical" | "adhered")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mechanical">Mechanical</SelectItem>
                        <SelectItem value="adhered">Adhered</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {attachment === "adhered" && (
                    <Field label="Adhesive">
                      <PickOne
                        value={membraneAdhesive}
                        options={["Water Based Adhesive", "Solvent Based Adhesive"]}
                        onChange={setMembraneAdhesive}
                      />
                    </Field>
                  )}
                  <Field label="Type">
                    <PickOne
                      value={String(sectionDefaults.thickness)}
                      options={["40", "50", "60"]}
                      onChange={(v) => setSectionDefaults((p) => ({ ...p, thickness: Number(v) }))}
                    />
                  </Field>
                  <Field label="Color">
                    <PickOne
                      value={sectionDefaults.color}
                      options={colorOptions}
                      onChange={(v) => setSectionDefaults((p) => ({ ...p, color: v }))}
                    />
                  </Field>
                  <Field label="Avg sheet">
                    <PickOne
                      value={sectionDefaults.sheetSizeLabel}
                      options={sheetSizeOptions}
                      onChange={(v) => setSectionDefaults((p) => ({ ...p, sheetSizeLabel: v }))}
                    />
                  </Field>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    setSections((p) =>
                      p.map((s) => ({
                        ...s,
                        deckType: sectionDefaults.deckType,
                        thickness: sectionDefaults.thickness,
                        color: sectionDefaults.color,
                        sheetSizeLabel: sectionDefaults.sheetSizeLabel,
                      })),
                    )
                  }
                >
                  Apply to existing roof sections
                </Button>
              </LegacyGroup>
              <LegacyGroup title="3. Select Type of Warranty">
                <PickOne
                  value={warrantyName || "None"}
                  options={warrantyOptions}
                  onChange={(v) => setWarrantyName(v === "None" ? "" : v)}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  High-wind term &amp; band are on the Pricing &amp; Warranty step.
                </p>
              </LegacyGroup>
            </CardContent>
          </Card>
        </div>

        <div className={step === 1 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Roof sections</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // New sections start from the Setup step's Defaults panel.
                  setSections((p) => [...p, newSection({ ...sectionDefaults })]);
                  setSelSection(sections.length);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> New section
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                {/* Left: editor for the selected section (legacy edits one section at a time) */}
                {(() => {
                  const i = Math.min(selSection, sections.length - 1);
                  const s = sections[i]!;
                  return (
                    <div key={s.id} className="min-w-0 rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <Input
                          className="h-8 w-[220px] font-medium"
                          value={s.name}
                          onChange={(e) => editSection(i, { name: e.target.value })}
                        />
                        <div className="flex items-center gap-1">
                          <SectionCalcDialog section={s} admin={admin} roofSystem={roofSystem} />
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Duplicate this section"
                            onClick={() => {
                              setSections((p) => [
                                ...p,
                                { ...clone(s), id: `s${seq++}`, name: `${s.name} (copy)` },
                              ]);
                              setSelSection(sections.length);
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => {
                              setSections((p) => p.filter((_, j) => j !== i));
                              setSelSection((v) => Math.max(0, Math.min(v, sections.length - 2)));
                            }}
                            disabled={sections.length === 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
                            onChange={(v) => editSectionWithSpacing(i, s, { thickness: Number(v) })}
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
                        <Field label="Field tab spacing (in)">
                          {TAB_OPTIONS_BY_SYSTEM[roofSystem] ? (
                            <PickOne
                              value={String(s.fieldLap)}
                              options={[
                                // Keep a legacy-invalid stored value visible rather than lying.
                                ...(TAB_OPTIONS_BY_SYSTEM[roofSystem]!.includes(s.fieldLap)
                                  ? []
                                  : [String(s.fieldLap)]),
                                ...TAB_OPTIONS_BY_SYSTEM[roofSystem]!.map(String),
                              ]}
                              onChange={(v) =>
                                editSectionWithSpacing(i, s, { fieldLap: Number(v) })
                              }
                            />
                          ) : (
                            <Input
                              type="number"
                              value={s.fieldLap}
                              onChange={(e) =>
                                editSectionWithSpacing(i, s, { fieldLap: num(e.target.value) })
                              }
                            />
                          )}
                        </Field>
                        <Field label="Fastener OC (in)">
                          <Input
                            type="number"
                            value={s.fastenerOc}
                            onChange={(e) => editSection(i, { fastenerOc: num(e.target.value) })}
                          />
                        </Field>
                        <Field label="Pull test (lbs)">
                          <Input
                            type="number"
                            value={s.pullTest ?? 0}
                            onChange={(e) =>
                              editSectionWithSpacing(i, s, { pullTest: num(e.target.value) })
                            }
                          />
                        </Field>
                        <Field label="Design table (psf)">
                          <PickOne
                            value={String(s.designTable ?? 60)}
                            options={DESIGN_TABLE_OPTIONS.map(String)}
                            onChange={(v) =>
                              editSectionWithSpacing(i, s, { designTable: Number(v) })
                            }
                          />
                        </Field>
                      </div>
                      {(s.pullTest ?? 0) > 0 &&
                        attachment === "mechanical" &&
                        fastenerLookup &&
                        (() => {
                          const rsId = LEGACY_ROOF_SYSTEM_IDS[roofSystem];
                          if (!rsId) return null;
                          const res = universalFastenerSpacing(fastenerLookup, {
                            roofSystemId: rsId,
                            thickness: s.thickness,
                            designTable: s.designTable ?? 60,
                            tabSpacings: [s.fieldLap],
                            pullTest: s.pullTest!,
                            columnOffset: 0,
                          });
                          return (
                            <p
                              className={`mt-1 text-xs ${res.ok ? "text-muted-foreground" : "text-destructive"}`}
                            >
                              {res.ok
                                ? `Pull test ${s.pullTest} lbs → ${res.inches}″ oc (legacy lookup; edit Fastener OC to override)`
                                : `Pull-test lookup: ${SPACING_ERROR_TEXT[res.error]}`}
                            </p>
                          );
                        })()}
                      <div className="mt-3 border-t pt-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground">
                            Edges &amp; perimeter / corner zones (leave length 0 to bill the whole
                            section as field)
                          </p>
                          {(s.edges?.length ?? 0) === 0 ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const edges = defaultEdges(s.length, s.width);
                                editSection(i, { edges, perimLengthFt: perimeterFromEdges(edges) });
                              }}
                            >
                              Define edges A–D
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => editSection(i, { edges: [] })}
                            >
                              Remove edges
                            </Button>
                          )}
                        </div>
                        {(s.edges?.length ?? 0) > 0 && (
                          <div className="mb-3 space-y-2">
                            {(s.edges ?? []).map((e, ei) => {
                              const editEdge = (patch: Partial<EdgeInput>) => {
                                const edges = (s.edges ?? []).map((x, j) =>
                                  j === ei ? { ...x, ...patch } : x,
                                );
                                editSection(i, { edges, perimLengthFt: perimeterFromEdges(edges) });
                              };
                              return (
                                <div
                                  key={e.side}
                                  className="grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-3 lg:grid-cols-5"
                                >
                                  <Field label={`Side ${e.side} length (ft)`}>
                                    <Input
                                      type="number"
                                      value={e.lengthFt}
                                      onChange={(ev) =>
                                        editEdge({ lengthFt: num(ev.target.value) })
                                      }
                                    />
                                  </Field>
                                  <Field label="Termination (ordering)">
                                    <PickOne
                                      value={e.termination}
                                      options={TERMINATION_OPTIONS}
                                      onChange={(v) => editEdge({ termination: v })}
                                    />
                                  </Field>
                                  <Field label="Blocking (ft)">
                                    <Input
                                      type="number"
                                      value={e.blockingFt}
                                      onChange={(ev) =>
                                        editEdge({ blockingFt: num(ev.target.value) })
                                      }
                                    />
                                  </Field>
                                  <Field label="ARP">
                                    <PickOne
                                      value={e.arpSizeIn === 0 ? "None" : `${e.arpSizeIn}"`}
                                      options={ARP_SIZE_OPTIONS.map((a) =>
                                        a === 0 ? "None" : `${a}"`,
                                      )}
                                      onChange={(v) =>
                                        editEdge({
                                          arpSizeIn: v === "None" ? 0 : Number(v.slice(0, -1)),
                                        })
                                      }
                                    />
                                  </Field>
                                  <div className="flex items-end gap-2 pb-1">
                                    <Switch
                                      id={`pe-${s.id}-${e.side}`}
                                      checked={e.isPerimeter}
                                      onCheckedChange={(v) => editEdge({ isPerimeter: v })}
                                    />
                                    <Label htmlFor={`pe-${s.id}-${e.side}`} className="text-xs">
                                      Perimeter edge
                                    </Label>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                          <Field
                            label={
                              (s.edges?.length ?? 0) > 0
                                ? "Perim len (from edges)"
                                : "Perim len (ft)"
                            }
                          >
                            <Input
                              type="number"
                              value={s.perimLengthFt}
                              disabled={(s.edges?.length ?? 0) > 0}
                              title={
                                (s.edges?.length ?? 0) > 0
                                  ? "Derived from the edges marked Perimeter edge"
                                  : undefined
                              }
                              onChange={(e) =>
                                editSection(i, { perimLengthFt: num(e.target.value) })
                              }
                            />
                          </Field>
                          <Field label="Corner len (ft)">
                            <Input
                              type="number"
                              value={s.cornerLengthFt}
                              onChange={(e) =>
                                editSection(i, { cornerLengthFt: num(e.target.value) })
                              }
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
                              onChange={(e) =>
                                editSection(i, { perimFastenerOc: num(e.target.value) })
                              }
                            />
                          </Field>
                          <Field label="Corner OC (in)">
                            <Input
                              type="number"
                              value={s.cornerFastenerOc}
                              onChange={(e) =>
                                editSection(i, { cornerFastenerOc: num(e.target.value) })
                              }
                            />
                          </Field>
                        </div>
                      </div>
                      <div className="mt-3 border-t pt-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground">
                            Insulation layers (up to 4)
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={(s.layers?.length ?? 0) >= 4}
                            onClick={() =>
                              editSection(i, {
                                layers: [
                                  ...(s.layers ?? []),
                                  {
                                    board: boardOptions[0] ?? "",
                                    attachment: "mechanical",
                                    fastenersPerBoard: fastenerOptions[0] ?? 5,
                                    adhesiveName: adhesiveOptions[0] ?? "",
                                    substrate: "",
                                  },
                                ],
                              })
                            }
                          >
                            <Plus className="mr-1 h-4 w-4" /> Add layer
                          </Button>
                        </div>
                        {(s.layers?.length ?? 0) === 0 ? (
                          <p className="text-xs text-muted-foreground">No insulation layers.</p>
                        ) : (
                          (s.layers ?? []).map((layer, li) => {
                            const editLayer = (patch: Partial<UnderlaymentLayer>) =>
                              editSection(i, {
                                layers: (s.layers ?? []).map((x, j) =>
                                  j === li ? { ...x, ...patch } : x,
                                ),
                              });
                            return (
                              <div
                                key={li}
                                className="mb-2 grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-3 lg:grid-cols-5"
                              >
                                <Field label={`Layer ${li + 1} board`}>
                                  <PickOne
                                    value={layer.board}
                                    options={boardOptions}
                                    onChange={(v) => editLayer({ board: v })}
                                  />
                                </Field>
                                <Field label="Attach">
                                  <PickOne
                                    value={layer.attachment}
                                    options={["mechanical", "adhesive"]}
                                    onChange={(v) =>
                                      editLayer({
                                        attachment: v as UnderlaymentLayer["attachment"],
                                      })
                                    }
                                  />
                                </Field>
                                {layer.attachment === "mechanical" ? (
                                  <Field label="Fasteners / 4×8 board">
                                    <PickOne
                                      value={String(
                                        layer.fastenersPerBoard || fastenerOptions[0] || 5,
                                      )}
                                      options={fastenerOptions.map(String)}
                                      onChange={(v) => editLayer({ fastenersPerBoard: Number(v) })}
                                    />
                                  </Field>
                                ) : (
                                  <>
                                    <Field label="Adhesive">
                                      <PickOne
                                        value={layer.adhesiveName}
                                        options={adhesiveOptions}
                                        onChange={(v) =>
                                          editLayer({ adhesiveName: v, substrate: "" })
                                        }
                                      />
                                    </Field>
                                    <Field label="Substrate">
                                      <PickOne
                                        value={layer.substrate}
                                        options={substratesFor(layer.adhesiveName)}
                                        onChange={(v) => editLayer({ substrate: v })}
                                      />
                                    </Field>
                                  </>
                                )}
                                <div className="flex items-end justify-end">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive"
                                    onClick={() =>
                                      editSection(i, {
                                        layers: (s.layers ?? []).filter((_, j) => j !== li),
                                        underlaymentBoard: "",
                                      })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        )}
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
                      <div className="mt-3 border-t pt-3">
                        <Field label="Section notes">
                          <Input
                            value={s.notes ?? ""}
                            placeholder="Optional notes for this section…"
                            onChange={(e) => editSection(i, { notes: e.target.value })}
                          />
                        </Field>
                      </div>
                    </div>
                  );
                })()}

                {/* Right rail: legacy section diagram + Roof Sections Summary */}
                <div className="space-y-4">
                  <EdgeDiagram section={sections[Math.min(selSection, sections.length - 1)]!} />
                  {/* Legacy Roof Sections Summary: Section | L | W | System | Attach | Deck | Color | Lap */}
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Section</TableHead>
                          <TableHead className="text-right">L</TableHead>
                          <TableHead className="text-right">W</TableHead>
                          <TableHead>System</TableHead>
                          <TableHead>Attach</TableHead>
                          <TableHead>Deck Type</TableHead>
                          <TableHead>Color</TableHead>
                          <TableHead className="text-right">Lap</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sections.map((s2, i2) => (
                          <TableRow
                            key={s2.id}
                            onClick={() => setSelSection(i2)}
                            className={
                              i2 === Math.min(selSection, sections.length - 1)
                                ? "cursor-pointer bg-muted/60"
                                : "cursor-pointer"
                            }
                          >
                            <TableCell className="whitespace-nowrap font-medium">
                              {s2.name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{s2.length}</TableCell>
                            <TableCell className="text-right tabular-nums">{s2.width}</TableCell>
                            <TableCell className="whitespace-nowrap">{roofSystem}</TableCell>
                            <TableCell className="capitalize">{attachment}</TableCell>
                            <TableCell className="whitespace-nowrap">{s2.deckType}</TableCell>
                            <TableCell>{s2.color}</TableCell>
                            <TableCell className="text-right tabular-nums">{s2.fieldLap}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Legacy per-section Man Hours / Labor Cost readout for the selected section */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border p-2 text-xs">
                    <span>
                      Man Hours:{" "}
                      <span className="font-semibold tabular-nums">
                        {(
                          result?.sectionHours[Math.min(selSection, sections.length - 1)] ?? 0
                        ).toFixed(2)}
                      </span>
                    </span>
                    <span>
                      Labor Cost:{" "}
                      <span className="font-semibold tabular-nums">
                        {money(
                          (result?.sectionHours[Math.min(selSection, sections.length - 1)] ?? 0) *
                            laborRate,
                        )}
                      </span>
                    </span>
                    <span className="text-muted-foreground">(selected section, install labor)</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Click a row to edit that section. Copy or remove it with the buttons at the top
                    of the editor.
                  </p>
                </div>
              </div>

              {/* Legacy bottom bar: Setup / Inspection / Roof SqFt / Membrane SqFt */}
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs">
                <span>
                  Setup time:{" "}
                  <span className="font-semibold tabular-nums">
                    {(result?.r.setupHours ?? 0).toFixed(2)} h
                  </span>
                </span>
                <span>
                  Inspection time:{" "}
                  <span className="font-semibold tabular-nums">
                    {(result?.r.inspectionHours ?? 0).toFixed(2)} h
                  </span>
                </span>
                <span>
                  Roof sq ft:{" "}
                  <span className="font-semibold tabular-nums">
                    {(result?.r.roofSqFootage ?? 0).toLocaleString()}
                  </span>
                </span>
                <span>
                  Membrane sq ft:{" "}
                  <span className="font-semibold tabular-nums">
                    {(result?.r.sqFtTotalMembrane ?? 0).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className={step === 2 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Parapets</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setParapets((p) => [
                    ...p,
                    newParapet({ heightBand: admin.parapetLabor?.bands[0] ?? "" }),
                  ]);
                  setSelParapet(parapets.length);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> New parapet
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {parapets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No parapet walls. Labor bills from the deck × wall-height matrix; membrane girth ×
                  length prices at the bid's default membrane.
                </p>
              ) : (
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  {(() => {
                    const i = Math.min(selParapet, parapets.length - 1);
                    const p = parapets[i]!;
                    return (
                      <div key={p.id} className="min-w-0 rounded-md border p-3">
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
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Duplicate this parapet"
                              onClick={() => {
                                setParapets((prev) => [
                                  ...prev,
                                  { ...clone(p), id: `p${pseq++}`, name: `${p.name} (copy)` },
                                ]);
                                setSelParapet(parapets.length);
                              }}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => {
                                setParapets((prev) => prev.filter((_, j) => j !== i));
                                setSelParapet((v) => Math.max(0, Math.min(v, parapets.length - 2)));
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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
                          <Field label="Pieces">
                            <Input
                              type="number"
                              min={0}
                              value={p.pieces ?? 1}
                              onChange={(e) =>
                                setParapets((prev) =>
                                  prev.map((x, j) =>
                                    j === i ? { ...x, pieces: num(e.target.value) } : x,
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
                        {/* Legacy wall profile dims: girth (billed membrane height) = their sum;
                            wall adhesive bills on Vertical + Wall top only. */}
                        {(() => {
                          const setDim = (
                            key:
                              | "skirtInches"
                              | "cantInches"
                              | "verticalInches"
                              | "wallTopInches"
                              | "dropInches",
                            v: number,
                          ) =>
                            setParapets((prev) =>
                              prev.map((x, j) => {
                                if (j !== i) return x;
                                const nx = { ...x, [key]: v };
                                nx.girthInches =
                                  (nx.skirtInches ?? 0) +
                                  (nx.cantInches ?? 0) +
                                  (nx.verticalInches ?? 0) +
                                  (nx.wallTopInches ?? 0) +
                                  (nx.dropInches ?? 0);
                                return nx;
                              }),
                            );
                          const dims: Array<
                            [
                              string,
                              (
                                | "skirtInches"
                                | "cantInches"
                                | "verticalInches"
                                | "wallTopInches"
                                | "dropInches"
                              ),
                            ]
                          > = [
                            ["Skirt", "skirtInches"],
                            ["Cant", "cantInches"],
                            ["Vertical", "verticalInches"],
                            ["Wall top", "wallTopInches"],
                            ["Drop", "dropInches"],
                          ];
                          return (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">
                                Wall profile (in) — membrane girth is the sum
                              </p>
                              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                                {dims.map(([label, key]) => (
                                  <Field key={key} label={label}>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={p[key] ?? 0}
                                      onChange={(e) => setDim(key, num(e.target.value))}
                                    />
                                  </Field>
                                ))}
                                <Field label="Girth (in)">
                                  <Input type="number" value={p.girthInches} readOnly disabled />
                                </Field>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  {/* Right rail: parapet summary */}
                  <div className="space-y-2">
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Parapet</TableHead>
                            <TableHead className="text-right">Len (ft)</TableHead>
                            <TableHead>Height</TableHead>
                            <TableHead>Deck</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parapets.map((p2, i2) => (
                            <TableRow
                              key={p2.id}
                              onClick={() => setSelParapet(i2)}
                              className={
                                i2 === Math.min(selParapet, parapets.length - 1)
                                  ? "cursor-pointer bg-muted/60"
                                  : "cursor-pointer"
                              }
                            >
                              <TableCell className="font-medium">{p2.name}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {p2.lengthFt}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{p2.heightBand}</TableCell>
                              <TableCell>{p2.deckType}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow>
                            <TableCell className="font-semibold">Total LF</TableCell>
                            <TableCell
                              colSpan={3}
                              className="text-right font-semibold tabular-nums"
                            >
                              {parapets.reduce((s2, p2) => s2 + p2.lengthFt, 0).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Click a row to edit that parapet.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className={step === 3 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Curbs</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCurbs((p) => [
                    ...p,
                    newCurb({ curbType: admin.curbLabor?.curbTypes[0] ?? "" }),
                  ]);
                  setSelCurb(curbs.length);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> New curb
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {curbs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No curbs. Labor bills per curb: setup + minutes/LF for the deck × curb-type
                  multiplier × perimeter.
                </p>
              ) : (
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  {(() => {
                    const i = Math.min(selCurb, curbs.length - 1);
                    const c = curbs[i]!;
                    return (
                      <div key={c.id} className="min-w-0 rounded-md border p-3">
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
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Duplicate this curb"
                              onClick={() => {
                                setCurbs((prev) => [
                                  ...prev,
                                  { ...clone(c), id: `c${cseq++}`, name: `${c.name} (copy)` },
                                ]);
                                setSelCurb(curbs.length);
                              }}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => {
                                setCurbs((prev) => prev.filter((_, j) => j !== i));
                                setSelCurb((v) => Math.max(0, Math.min(v, curbs.length - 2)));
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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
                    );
                  })()}

                  {/* Right rail: curb summary */}
                  <div className="space-y-2">
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Curb</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">A (in)</TableHead>
                            <TableHead className="text-right">B (in)</TableHead>
                            <TableHead>Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {curbs.map((c2, i2) => (
                            <TableRow
                              key={c2.id}
                              onClick={() => setSelCurb(i2)}
                              className={
                                i2 === Math.min(selCurb, curbs.length - 1)
                                  ? "cursor-pointer bg-muted/60"
                                  : "cursor-pointer"
                              }
                            >
                              <TableCell className="font-medium">{c2.name}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {c2.quantity}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {c2.widthIn}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {c2.lengthIn}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{c2.curbType}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow>
                            <TableCell className="font-semibold">Total curbs</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {curbs.reduce((s2, c2) => s2 + c2.quantity, 0).toLocaleString()}
                            </TableCell>
                            <TableCell colSpan={3} />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground">Click a row to edit that curb.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className={step === 4 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
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
                <SelectTrigger className="w-[240px] max-w-full">
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

          {/* Legacy red/green "needed" quantities (docs/legacy-consumption-rules.md §2). */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Calculated needs (legacy ordering rules)</CardTitle>
              <CardDescription>
                Computed from your sections, edges, insulation and parapets — red means still needed
                after what you&apos;ve added above, green means covered. Display only; never changes
                the bid total.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                const rows: { label: string; needed: number; entered: number | null }[] = [
                  {
                    label: `Screws (membrane ${neededQty.breakdown.membraneScrews} + bars ${neededQty.breakdown.edgeBarScrews} + two-piece ${neededQty.breakdown.twoPieceScrews} + insulation ${neededQty.breakdown.insulationScrews} + parapet decks ${neededQty.breakdown.parapetDeckScrews})`,
                    needed: neededQty.screws,
                    entered: enteredQty.screws,
                  },
                  {
                    label: "Poly plates (1 per membrane screw + parapet decks)",
                    needed: neededQty.polyPlates,
                    entered: enteredQty.polyPlates,
                  },
                  {
                    label: "Insulation plates (1 per insulation screw)",
                    needed: neededQty.insulationPlates,
                    entered: enteredQty.insulationPlates,
                  },
                  {
                    label: "Duro-Caulk tubes (1 per 12 LF of term bar/fascia)",
                    needed: neededQty.caulkTubes,
                    entered: enteredQty.caulk,
                  },
                  ...Object.entries(neededQty.adhesiveUnits).map(([name, units]) => ({
                    label: `${name} (units, whole-unit per estimate)`,
                    needed: units,
                    entered: null,
                  })),
                ].filter((r) => r.needed > 0 || (r.entered ?? 0) > 0);
                if (rows.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground">
                      Nothing to calculate yet — add edge terminations, insulation layers, or
                      parapets and the needed fasteners, plates, caulk and adhesive units appear
                      here.
                    </p>
                  );
                }
                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Needed</TableHead>
                        <TableHead className="text-right">Entered</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const remaining = r.needed - (r.entered ?? 0);
                        return (
                          <TableRow key={r.label}>
                            <TableCell className="whitespace-normal">{r.label}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.needed.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.entered === null ? "—" : r.entered.toLocaleString()}
                            </TableCell>
                            <TableCell
                              className={`text-right font-semibold tabular-nums ${
                                r.entered !== null && remaining > 0
                                  ? "text-destructive"
                                  : "text-green-700 dark:text-green-500"
                              }`}
                            >
                              {r.entered === null
                                ? "order"
                                : remaining > 0
                                  ? `−${remaining.toLocaleString()} needed`
                                  : "covered"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                Rules from the extracted legacy engine: membrane screws from the row-style
                field/perimeter count (mark perimeter edges in Sections for the perimeter rows; the
                legacy 30-ft perimeter strip constant is flagged for bid validation), 21 screws per
                10-ft bar (42/63 for two-piece), insulation fasteners per board density (doubled
                under adhered/Duro-Bond membranes), plates 1-per-screw, adhesive units area ÷
                coverage ceilinged once per adhesive. Entered fastener boxes count toward Screws
                only when the fastener&apos;s subtype is allowed for a deck in this bid (e.g. Augers
                for Gypsum/Tectum, Drill Points for Wood/Steel) — same rule as legacy. Not included:
                washer/drain caulk adders, pipe-stack sealant, and custom-layout sheets — add those
                manually for now.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className={step === 5 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
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
                <SelectTrigger className="w-[240px] max-w-full">
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
        </div>

        <div className={step === 6 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
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
                        category: item.category,
                        price: item.price,
                        laborPerUnit: item.laborPerUnit,
                        laborRate: item.laborRate,
                        quantity: 1,
                      },
                    ]);
                }}
              >
                <SelectTrigger className="w-[240px] max-w-full">
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
                  No non-DL items. Blocking / deck / sheet-metal / masonry items price material into
                  Other material and labor as direct labor; subcontractors &amp; services roll into
                  Subs &amp; services.
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
        </div>

        <div className={step === 7 ? "space-y-6" : "hidden"}>
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
              <Field label="Adjust setup %">
                <Input
                  type="number"
                  value={adjustSetupPct}
                  onChange={(e) => setAdjustSetupPct(num(e.target.value))}
                />
              </Field>
              <Field label="Adjust inspection %">
                <Input
                  type="number"
                  value={adjustInspectionPct}
                  onChange={(e) => setAdjustInspectionPct(num(e.target.value))}
                />
              </Field>
              <Field label="Labor template">
                <PickOne
                  value={laborTemplateName || "None"}
                  options={laborTemplateOptions}
                  onChange={(v) => setLaborTemplateName(v === "None" ? "" : v)}
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
                  <Switch
                    id="pdim"
                    checked={perDiemInMarkup}
                    onCheckedChange={setPerDiemInMarkup}
                  />
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

        <div className={step === 8 ? "space-y-6" : "hidden"}>
          {hasOrderingSummary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ordering summary (informational)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {edgeSummary.terminations.map((t) => (
                  <div key={t.termination} className="flex justify-between">
                    <span className="text-muted-foreground">{t.termination}</span>
                    <span className="tabular-nums">{t.totalFt.toLocaleString()} ft</span>
                  </div>
                ))}
                {edgeSummary.blockingFt > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Wood blocking</span>
                    <span className="tabular-nums">
                      {edgeSummary.blockingFt.toLocaleString()} ft
                    </span>
                  </div>
                )}
                {edgeSummary.arpSqFtTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ARP (§2.3, incl. 3% waste)</span>
                    <span className="tabular-nums">
                      {edgeSummary.arpSqFtTotal.toFixed(1)} sq ft
                    </span>
                  </div>
                )}
                {insulationBoards > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Insulation boards (4×8)</span>
                    <span className="tabular-nums">{insulationBoards.toLocaleString()}</span>
                  </div>
                )}
                {insulationFasteners > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Insulation fasteners</span>
                    <span className="tabular-nums">{insulationFasteners.toLocaleString()}</span>
                  </div>
                )}
                {Object.entries(adhesiveUnitTotals).map(([name, units]) => (
                  <div key={name} className="flex justify-between">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="tabular-nums">{units.toFixed(2)} units</span>
                  </div>
                ))}
                <p className="border-t pt-2 text-xs text-muted-foreground">
                  For ordering only — termination hardware, blocking and ARP material are priced by
                  adding Accessory / Non-DL lines until the legacy auto-pricing is validated against
                  a captured bid.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review &amp; finish</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                The full cost and hours breakdown is in the Bid total panel{" "}
                <span className="lg:hidden">below</span>
                <span className="hidden lg:inline">on the right</span>.{" "}
                {result?.warnings.length
                  ? "Resolve the warnings shown there before finalizing."
                  : "No input warnings."}
              </p>
              <div className="flex flex-wrap gap-2">
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
                <Button
                  variant="outline"
                  disabled={!result}
                  title="Download the estimate review as CSV"
                  onClick={exportReview}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="outline" disabled={step === 0} onClick={() => goStep(step - 1)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Step {step + 1} of {STEPS.length} — {STEPS[step]!.label}
          </span>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => goStep(step + 1)}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : "Save bid"}
            </Button>
          )}
        </div>
      </div>

      <div id="bid-total-panel" className="lg:sticky lg:top-4 lg:self-start">
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
                        result.metalsMaterial -
                        result.adhesiveMaterial,
                    )}
                  />
                  {result.parapetMaterial > 0 && (
                    <Row label="Parapet material" v={money(result.parapetMaterial)} />
                  )}
                  {result.metalsMaterial > 0 && (
                    <Row label="Metals material" v={money(result.metalsMaterial)} />
                  )}
                  {result.adhesiveMaterial > 0 && (
                    <Row label="Adhesive material" v={money(result.adhesiveMaterial)} />
                  )}
                  {accessoryTotal > 0 && <Row label="Accessories" v={money(accessoryTotal)} />}
                  {(result.r.money.dTotals[6] ?? 0) > 0 && (
                    <Row label="Underlayment" v={money(result.r.money.dTotals[6] ?? 0)} />
                  )}
                  {nonDlMaterialTotal > 0 && (
                    <Row label="Other material (non-DL)" v={money(nonDlMaterialTotal)} />
                  )}
                  {/* APPLIED discounts only (d[4]−d[0]); the candidate d[1..3] values exist even
                      when their toggles are off and must not be displayed as if applied. */}
                  {(result.r.money.dTotals[4] ?? 0) - (result.r.money.dTotals[0] ?? 0) < 0 && (
                    <Row
                      label="Discounts"
                      v={money((result.r.money.dTotals[4] ?? 0) - (result.r.money.dTotals[0] ?? 0))}
                    />
                  )}
                  {(result.r.money.dTotals[5] ?? 0) > 0 && (
                    <Row label="Warranty" v={money(result.r.money.dTotals[5] ?? 0)} />
                  )}
                  {/* Material-only sales tax lives INSIDE Purchases (legacy §4.1); surface it so
                      the visible lines sum to Subtotal 1. d[8] − d[4..7] isolates it. */}
                  {(() => {
                    const dd = result.r.money.dTotals;
                    const matTax =
                      (dd[8] ?? 0) - (dd[4] ?? 0) - (dd[5] ?? 0) - (dd[6] ?? 0) - (dd[7] ?? 0);
                    return matTax > 0.005 ? (
                      <Row label="Sales tax (material)" v={money(matTax)} />
                    ) : null;
                  })()}
                  {(result.r.money.dTotals[9] ?? 0) > 0 && (
                    <Row label="Shipping" v={money(result.r.money.dTotals[9] ?? 0)} />
                  )}
                  <Row label="Labor" v={money(result.r.laborSubtotal1)} />
                  {result.r.laborSubtotal2 > 0 && (
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
                {result.r.underlaymentLaborHours > 0 && (
                  <div className="flex justify-between">
                    <span>Underlayment hours</span>
                    <span>{result.r.underlaymentLaborHours.toFixed(2)}</span>
                  </div>
                )}
                {result.ownRateHours > 0 && (
                  <div className="flex justify-between">
                    <span>Metals &amp; non-DL hours</span>
                    <span>{result.ownRateHours.toFixed(2)}</span>
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

      {/* Mobile: the live total stays in reach on every step (the panel itself sits at the
          bottom of the page on small screens). */}
      {result && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            Bid total
            {result.warnings.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
          </span>
          <span className="font-semibold tabular-nums">{money(result.r.money.grandTotal)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              document.getElementById("bid-total-panel")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            Details
          </Button>
        </div>
      )}
    </div>
  );
}

/** Legacy Roof Sections diagram: the section rectangle with sides A (top), B (right),
    C (bottom), D (left), annotated from the edges editor. Display-only. */
function EdgeDiagram({ section }: { section: BidSectionInput }) {
  const edges = section.edges ?? [];
  const by = (side: string) => edges.find((e) => e.side === side);
  const SideInfo = ({
    side,
    fallbackLen,
    className,
  }: {
    side: string;
    fallbackLen: number;
    className?: string;
  }) => {
    const e = by(side);
    return (
      <div className={`text-[11px] leading-tight ${className ?? ""}`}>
        <p className="font-semibold">
          {side}: {e?.lengthFt ?? fallbackLen}′
        </p>
        {e ? (
          <>
            <p>{e.termination || "No Termination"}</p>
            <p>{e.blockingFt > 0 ? `Blocking ${e.blockingFt}′` : "No Blocking"}</p>
            <p>ARP: {e.arpSizeIn > 0 ? `${e.arpSizeIn}"` : "None"}</p>
            {e.isPerimeter && <p className="text-muted-foreground">Perimeter edge</p>}
          </>
        ) : (
          <p className="text-muted-foreground">—</p>
        )}
      </div>
    );
  };
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-semibold">{section.name}</p>
        {edges.length === 0 && (
          <p className="text-[11px] text-muted-foreground">Define edges A–D to annotate</p>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div />
        <SideInfo side="A" fallbackLen={section.length} className="text-center" />
        <div />
        <SideInfo side="D" fallbackLen={section.width} className="text-right" />
        <div className="relative h-28 w-24 border-2 border-foreground/50 bg-muted/30">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-yellow-400/90" title="Side A" />
          <span className="absolute inset-x-0 bottom-1 text-center text-[10px] text-muted-foreground">
            Length ⟷
          </span>
          <span
            className="absolute inset-y-0 left-0.5 flex items-center text-[10px] text-muted-foreground"
            style={{ writingMode: "vertical-rl" }}
          >
            Width ↕
          </span>
        </div>
        <SideInfo side="B" fallbackLen={section.width} />
        <div />
        <SideInfo side="C" fallbackLen={section.length} className="text-center" />
        <div />
      </div>
    </div>
  );
}

/** Legacy-style numbered group box ("1. General Info", "2. Labor & Markup Setup", …). */
function LegacyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-semibold">{title}</p>
      {children}
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
