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
  sectionLayers,
  fluteFillerPieces,
  type UnderlaymentLayer,
} from "@/lib/engine/bid-builder";
import { computeEstimate, computeSectionInstallHours } from "@/lib/engine/estimate";
import { normalizeAdminSnapshot } from "@/lib/engine/adapters";
import { buildReviewLedger } from "@/lib/engine/review-ledger";
import { EstimateReviewLedger } from "@/components/estimate-review-ledger";
import type { MarkupMode } from "@/lib/engine/money";
import { defaultEdges, summarizeEdges, TERMINATION_OPTIONS } from "@/lib/engine/edges";
import { SectionsScreen } from "@/components/sections-screen";
import { AccessoriesScreens } from "@/components/accessories-screens";
import { MetalsScreens } from "@/components/metals-screens";
import { CurbsScreen } from "@/components/curbs-screen";
import { NonDlScreens } from "@/components/nondl-screens";
import { emptyNonDlState, normalizeNonDlState, type NonDlState } from "@/lib/engine/nondl";
import {
  emptyAccessoriesState,
  normalizeAccessoriesState,
  TERMINATION_ID_BY_LABEL,
  type AccessoriesState,
} from "@/lib/engine/accessories";
import { emptyMetalsState, normalizeMetalsState, type MetalsState } from "@/lib/engine/metals";
import {
  BUILDING_TYPES,
  MAX_WIND_OPTIONS,
  buildBidInput,
  cityStZip,
  effectiveHighWind,
  emptyCustomer,
  markupTypeToMode,
  resolveBidComputeData,
  type CustomerInfo,
  type SavedBidState,
  type WarrantyData,
} from "@/lib/proposal-bid";
import { LEGACY_ROOF_SYSTEM_IDS, universalFastenerSpacing } from "@/lib/engine/fastener-spacing";
import { DESIGN_TABLE_OPTIONS } from "@/lib/engine/fastener-spacing";
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
import type { EngineAdminData } from "@/lib/engine/adapters";
import { BID_STATUSES, STATUS_LABELS, asBidStatus, type BidStatus } from "@/lib/bid-status";
import { useAuth } from "@/lib/auth-context";
import { buildReviewRows, toCsv } from "@/lib/review-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
// No estimator value may go negative: the shared parser floors at 0. The legacy labor-adjust
// DELTAS (AdjustLabor % − 100) are the one field family where a negative is meaningful
// (−20 = 80% labor); numAdj floors those at −100 so hours can never invert.
const num = (v: string) => Math.max(0, (v.trim() === "" || v === "-" ? 0 : Number(v)) || 0);
const numAdj = (v: string) => Math.max(-100, (v.trim() === "" || v === "-" ? 0 : Number(v)) || 0);
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
  // Legacy Edge Options: four sides (A/C = Length, B/D = Width), no corners, Quick Bid,
  // Complexity "Moderate" (index 2 — only priced on systems with RSComplexityFactor rows).
  edges: defaultEdges(100, 100),
  perimCorners: [false, false, false, false],
  isQuickBid: true,
  complexity: 2,
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
  // Legacy wall profile dims (in); girth = their sum. Defaults keep the prior 36" girth.
  skirtInches: 0,
  cantInches: 0,
  verticalInches: 24,
  wallTopInches: 12,
  dropInches: 0,
  girthInches: 36,
  // Legacy Setup default "2. Wall Type": Wood or Metal (1) — drives the pre-drill labor column.
  wallType: 1,
  // Legacy Pieces (membrane pieces wrapping the wall): AdjustedLength = length + 1 + pieces.
  pieces: 1,
  ...defaults,
});

let cseq = 1;
const newCurb = (defaults: Partial<CurbInput> = {}): CurbInput => ({
  id: `c${cseq++}`,
  name: `Curb ${cseq - 1}`,
  quantity: 1,
  // Legacy frmCurbs textbox defaults: A 1, B 1, C 12, Skirt (D) 6.
  widthIn: 1,
  lengthIn: 1,
  // One legacy style selection drives BOTH the wrap model and the labor type (docs §8.1):
  // default style 1 = Open.
  curbType: "Open",
  deckType: "Wood",
  styleId: 1,
  dimCIn: 12,
  dimDIn: 6,
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
  { key: "underlayment", label: "Underlayment" },
  { key: "parapets", label: "Parapets" },
  { key: "curbs", label: "Curbs" },
  { key: "accessories", label: "Accessories" },
  { key: "metals", label: "Metals" },
  { key: "tearoff", label: "Tear-Off" },
  { key: "nondl", label: "Non-DL" },
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
  const [accessoriesCalc, setAccessoriesCalc] = useState<AccessoriesState>(() =>
    emptyAccessoriesState(),
  );
  const [nonDlLines, setNonDlLines] = useState<NonDlLine[]>([]);
  const [metals, setMetals] = useState<MetalLine[]>([]);
  const [metalsCalc, setMetalsCalc] = useState<MetalsState>(() => emptyMetalsState());
  const [nonDlCalc, setNonDlCalc] = useState<NonDlState>(() => emptyNonDlState());
  const [parapets, setParapets] = useState<ParapetInput[]>([]);
  const [curbs, setCurbs] = useState<CurbInput[]>([]);
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer());
  const [markupMode, setMarkupMode] = useState<MarkupMode>(2);
  const [markup, setMarkup] = useState(35);
  const [laborRate, setLaborRate] = useState(50);
  const [extraShipping, setExtraShipping] = useState(0);
  // The legacy Review screen shows the ledger; the auxiliary knobs (warranty picker, labor
  // rate, templates…) sit behind this toggle instead of always-on forms.
  const [showPricingSettings, setShowPricingSettings] = useState(false);
  // A saved bid whose row has no usable data ({} / null): surface it loudly instead of quietly
  // showing a fresh default estimate under the saved name (the "smith elemetry" bug).
  const [loadedBidEmpty, setLoadedBidEmpty] = useState(false);
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
  const [sectionDefaults, setSectionDefaults] = useState<
    NonNullable<SavedBidState["sectionDefaults"]>
  >({
    deckType: "Wood",
    thickness: 40,
    color: "White",
    sheetSizeLabel: "1500 sf",
    designTable: 60,
  });
  // Legacy Home "5. Parapets Material" / "2. Wall Type" / "4. Underlayment Attached With" defaults.
  const [parapetDefaults, setParapetDefaults] = useState<
    NonNullable<SavedBidState["parapetDefaults"]>
  >({ wallType: 1 });
  const [underlaymentAttachmentDefault, setUnderlaymentAttachmentDefault] = useState<
    "mechanical" | "adhesive" | "none"
  >("mechanical");
  // Legacy Home General Info: Building Type + Date Created (Estimate.StartDate, editable).
  const [buildingType, setBuildingType] = useState<string>("Commercial");
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  // Legacy per-estimate sales tax (null = the company settings; Tax Exempt zeroes it).
  const [salesTaxRate, setSalesTaxRate] = useState<number | null>(null);
  const [taxMaterialOnly, setTaxMaterialOnly] = useState<boolean | null>(null);
  // Legacy Estimate.MaxWindExpected (the high-wind band picker on Home).
  const [maxWindExpected, setMaxWindExpected] = useState<number | undefined>(undefined);
  const [showLaborMarkup, setShowLaborMarkup] = useState(false);
  const [confirmApplySections, setConfirmApplySections] = useState(false);
  const [selSection, setSelSection] = useState(0);
  const [selParapet, setSelParapet] = useState(0);
  const [selCurb, setSelCurb] = useState(0);
  const [highWind, setHighWind] = useState(false);
  const [highWindTermYears, setHighWindTermYears] = useState(0);
  const [highWindBand, setHighWindBand] = useState("");

  const [presetName, setPresetName] = useState("");
  const applyPreset = (name: string) => {
    const p = presets?.find((x) => x.name === name);
    if (!p) return;
    setPresetName(name);
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

  // Underlayment step (legacy Underlayment/Insulation screen): section multi-select + the
  // pending layer being configured (board / attachment) before it's applied to the selection.
  const [uSel, setUSel] = useState<string[]>([]);
  const [uTab, setUTab] = useState(0); // 0..3 → Layer 1..4
  const [uBoard, setUBoard] = useState("");
  // Selected insulation-type parent tile (legacy Select Insulation Type); null = follow uBoard.
  const [uGroup, setUGroup] = useState<number | null>(null);
  // Enhancement Options (legacy frmUnderlaymentAdv, docs §10.3): custom fastener densities
  // (per sq ft) + custom adhesive ribbon spacing; applied per section.
  const [uEnhOpen, setUEnhOpen] = useState(false);
  const [uEnhFasteners, setUEnhFasteners] = useState(false);
  const [uEnhField, setUEnhField] = useState(0.15625); // 5 per 4×8 board
  const [uEnhPerim, setUEnhPerim] = useState(0.15625);
  const [uEnhCorner, setUEnhCorner] = useState(0.15625);
  const [uEnhSpacing, setUEnhSpacing] = useState(0); // 0 = default coverage
  // Custom-quote flow (legacy NeedQuote entries — Flute Filler / Tapered/Other / ISO-Rigid
  // Quote, docs §10.5): the dialog mirrors the captured HandleFluteFiller form.
  const [uQuoteBoard, setUQuoteBoard] = useState<string | null>(null);
  const [qName, setQName] = useState("New Quote");
  const [qPieceMode, setQPieceMode] = useState(false);
  const [qLump, setQLump] = useState(0);
  const [qPieces, setQPieces] = useState(0);
  const [qCpp, setQCpp] = useState(0);
  const [qLabor, setQLabor] = useState(0);
  const [qLaborDays, setQLaborDays] = useState(false);
  // frmQuoteDecision (§10.7): merge into an existing quote on the selection, or start new.
  const [qMerge, setQMerge] = useState(true);
  // frmFluteFillerCalc inputs (§10.7): piece length (ft), ridge-to-ridge (in), waste %.
  const [qFfLen, setQFfLen] = useState(4);
  const [qFfR2R, setQFfR2R] = useState(24);
  const [qFfPlus, setQFfPlus] = useState(0);
  // Adhered-layer quote containers over tapered surfaces (§10.7 QuoteAdhesiveUnits).
  const [uQAU, setUQAU] = useState(0);
  const openQuoteDialog = (board: string) => {
    // When the selection already carries this board's quote, surface its name (the merge target).
    setQName(existingQuoteFor(board)?.name ?? "New Quote");
    setQPieceMode(false);
    setQLump(0);
    setQPieces(0);
    setQCpp(0);
    setQLabor(0);
    setQLaborDays(false);
    setQMerge(true);
    setUQuoteBoard(board);
  };
  /** The existing quote for this entry on the selected sections' current layer, if any. */
  const existingQuoteFor = (board: string) => {
    for (const s of sections) {
      if (!uSel.includes(s.id)) continue;
      const l = sectionLayers(s)[uTab];
      if (l?.quote && l.board === board) return l.quote;
    }
    return undefined;
  };
  const [uAttach, setUAttach] = useState<"mechanical" | "adhesive">("mechanical");
  const [uFast, setUFast] = useState(0);
  const [uAdh, setUAdh] = useState("");
  const [uSub, setUSub] = useState("");

  // Tear-Off step (legacy multi-select pattern): section selection + the pending options.
  const [toSel, setToSel] = useState<string[]>([]);
  const [toType, setToType] = useState("");
  const [toDepth, setToDepth] = useState(0);

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
    setLoadedBidEmpty(!(d && Array.isArray(d.sections)));
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
      setAccessoriesCalc(normalizeAccessoriesState(d.accessoriesCalc));
      setNonDlLines(Array.isArray(d.nonDlLines) ? d.nonDlLines : []);
      setMetals(Array.isArray(d.metals) ? d.metals : []);
      setMetalsCalc(normalizeMetalsState(d.metalsCalc));
      setNonDlCalc(normalizeNonDlState(d.nonDlCalc));
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
      setExtraShipping(d.extraShipping ?? 0);
      setPerDiemInMarkup(d.perDiemInMarkup ?? true);
      setCommissionInMarkup(d.commissionInMarkup ?? false);
      setAdjustLaborPct(d.adjustLaborPct ?? 0);
      setAdjustSetupPct(d.adjustSetupPct ?? 0);
      setAdjustInspectionPct(d.adjustInspectionPct ?? 0);
      setLaborTemplateName(d.laborTemplateName ?? "");
      setWarrantyName(d.warrantyName ?? "");
      if (d.sectionDefaults) setSectionDefaults({ designTable: 60, ...d.sectionDefaults });
      setParapetDefaults(d.parapetDefaults ? { ...d.parapetDefaults } : { wallType: 1 });
      setUnderlaymentAttachmentDefault(d.underlaymentAttachmentDefault ?? "mechanical");
      if (d.underlaymentAttachmentDefault && d.underlaymentAttachmentDefault !== "none")
        setUAttach(d.underlaymentAttachmentDefault);
      setBuildingType(d.buildingType ?? "Commercial");
      setStartDate(
        d.startDate ??
          ((loadedBid as { created_at?: string }).created_at ?? new Date().toISOString()).slice(
            0,
            10,
          ),
      );
      setSalesTaxRate(d.salesTaxRate ?? null);
      setTaxMaterialOnly(d.taxMaterialOnly ?? null);
      setMaxWindExpected(d.maxWindExpected);
      setHighWind(d.highWind ?? false);
      setHighWindTermYears(d.highWindTermYears ?? 0);
      setHighWindBand(d.highWindBand ?? "");
      setSnapshot(
        d.adminSnapshot
          ? {
              admin: normalizeAdminSnapshot(d.adminSnapshot),
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

  // NEW bids start from the seeded admin default (legacy Labor & Markup Options "Default":
  // $45/hr, 35% gross profit) instead of hardcoded fallbacks; saved bids keep their own values.
  const appliedDefaultPreset = useRef(false);
  useEffect(() => {
    if (appliedDefaultPreset.current || bidParam || !presets?.length) return;
    const def = presets.find((x) => x.isDefault) ?? presets[0];
    if (def) applyPreset(def.name);
    appliedDefaultPreset.current = true;
    // applyPreset is recreated each render; the ref guard makes this effectively run-once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, bidParam]);

  const parapetWallStats = useMemo(() => {
    let vert = 0;
    let total = 0;
    for (const p of parapets) {
      const hasDims =
        p.skirtInches !== undefined ||
        p.cantInches !== undefined ||
        p.verticalInches !== undefined ||
        p.wallTopInches !== undefined ||
        p.dropInches !== undefined;
      if (hasDims) {
        vert += (p.lengthFt * (p.verticalInches ?? 0)) / 12;
        total +=
          (p.lengthFt *
            ((p.verticalInches ?? 0) +
              (p.dropInches ?? 0) +
              (p.cantInches ?? 0) +
              (p.wallTopInches ?? 0))) /
          12;
      } else {
        total += (p.lengthFt * p.girthInches) / 12;
      }
    }
    return { vert, total };
  }, [parapets]);

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

  const saved: SavedBidState = {
    roofSystem,
    attachment,
    extraShipping,
    membraneAdhesiveName: membraneAdhesive,
    sections,
    accessories,
    accessoriesCalc,
    nonDlLines,
    metals,
    metalsCalc,
    nonDlCalc,
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
    parapetDefaults,
    underlaymentAttachmentDefault,
    buildingType,
    startDate,
    ...(salesTaxRate !== null ? { salesTaxRate } : {}),
    ...(taxMaterialOnly !== null ? { taxMaterialOnly } : {}),
    ...(maxWindExpected !== undefined ? { maxWindExpected } : {}),
    warrantyName,
    highWind,
    highWindTermYears,
    highWindBand,
  };
  const bid: BidInput = buildBidInput(saved, warrantyData);
  // Legacy high-wind semantics: the warranty carries IsHighWind + its term; the bid picks the
  // Max Expected Wind band (docs §17).
  const effHighWind = warrantyData ? effectiveHighWind(saved, warrantyData) : null;
  const selectedWarranty = warrantyData?.warranties.find((w) => w.name === warrantyName);
  // Legacy frmMembTypeSelect: sections thinner than the warranty's ReqThickness.
  const thinSections = selectedWarranty?.reqThickness
    ? sections.filter((sec) => sec.thickness < selectedWarranty.reqThickness!)
    : [];
  // Legacy frmHome.TestForEnhancement on the default section (pull test 350, lap 60).
  const defaultsEnhancement = (() => {
    if (!fastenerLookup?.length || attachment !== "mechanical") return null;
    const rsId = LEGACY_ROOF_SYSTEM_IDS[roofSystem];
    if (!rsId) return null;
    const r = universalFastenerSpacing(fastenerLookup, {
      roofSystemId: rsId,
      thickness: sectionDefaults.thickness,
      designTable: sectionDefaults.designTable ?? 60,
      tabSpacings: [60],
      pullTest: 350,
      columnOffset: 0,
    });
    return r.ok ? null : "<- Enhancement Necessary";
  })();
  const effSalesTaxRate = salesTaxRate ?? admin?.settings.salesTax ?? 0;
  const effTaxMaterialOnly = taxMaterialOnly ?? admin?.settings.taxMaterialOnly ?? false;

  const result = useMemo(() => {
    if (!admin) return null;
    const build = buildEstimateInputs(bid, admin);
    const { inputs, warnings, parapetMaterial, metalsMaterial, adhesiveMaterial, curbMaterial } =
      build;
    const accessoriesResult = build.accessories;
    const adhesiveWholeUnits = build.adhesiveWholeUnits;
    const r = computeEstimate(inputs);
    return {
      r,
      // The legacy Estimate Review ledger rows (attribution of the amounts billed above).
      ledger: buildReviewLedger({
        bid,
        result: build,
        est: r,
        crewRate: bid.crewLaborRatePerHour,
      }),
      // Per-section install hours (legacy per-section Man Hours); inputs.sections is
      // built 1:1 in order from bid.sections.
      sectionHours: inputs.sections.map((rs) =>
        computeSectionInstallHours(rs, inputs.admin, inputs.formulasVersion, inputs.adjustLaborPct),
      ),
      warnings,
      parapetMaterial,
      metalsMaterial,
      adhesiveMaterial,
      curbMaterial,
      // Own-rate direct-labor hours (metals + categorized non-DL); they join man-days but are
      // priced at each line's own rate, so they aren't in any crew-rate hour bucket.
      ownRateHours: inputs.ownRateDirectLaborHours ?? 0,
      // §12 Accessories calculated-screen results + the adhesive whole-unit Calc Qtys.
      accessories: accessoriesResult,
      adhesiveWholeUnits,
      // §13 EXCEPTIONAL Metals screen results (summary lines + dMaterial[5]/dLabor[5] totals).
      metalsScreen: build.metalsScreen,
      // §14 Non-Duro-Last Items results (six dialogs + auto rows; OtherMaterial / LS1 / LS2).
      nonDl: build.nonDl,
      // Per-curb legacy ManHours for the Curbs screen "Labor: X hours" readout.
      curbHoursById: build.breakdown.curbHoursById,
    };
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
      case "underlayment":
        return sections.filter((s) => (s.layers?.length ?? 0) > 0 || s.underlaymentBoard).length;
      case "parapets":
        return parapets.length;
      case "curbs":
        return curbs.length;
      case "accessories":
        return accessories.length;
      case "metals":
        return metals.length + (result?.metalsScreen?.lines.length ?? 0);
      case "tearoff":
        return sections.filter((s) => s.tearOff).length;
      case "nondl":
        return nonDlLines.length + (result?.nonDl?.lines.length ?? 0);
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
        result.curbMaterial -
        result.metalsMaterial -
        result.adhesiveMaterial,
      parapetMaterial: result.parapetMaterial,
      curbMaterial: result.curbMaterial,
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
      salesTaxValue: result.r.money.taxCharged,
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
        {loadedBidEmpty && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <span className="font-semibold">This saved bid has no stored data.</span> What you see
            below is a fresh default estimate under its name — nothing here was loaded from the
            save. Saving will write the current inputs over the empty record.
          </div>
        )}
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
          {/* Legacy frmHome: "Setup" panel (Bid Info | Client | Job Site) on the left, the
              "Defaults" panel on the right (docs §17). */}
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
                      <Field label="Customer Name">
                        <Input
                          value={customer.name}
                          onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                        />
                      </Field>
                      <Field label="Job Name">
                        <Input
                          value={bidName}
                          onChange={(e) => setBidName(e.target.value)}
                          onBlur={() => {
                            // Legacy txtEstimateTitle_LostFocus: "Bid Title cannot be left blank."
                            if (bidName.trim() === "") {
                              toast.error("Bid Title cannot be left blank.");
                              setBidName("Untitled bid");
                            }
                          }}
                        />
                      </Field>
                      <Field label="Estimator's Name">
                        <Input
                          value={customer.estimatorName ?? ""}
                          onChange={(e) =>
                            setCustomer((c) => ({ ...c, estimatorName: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label="Date Created">
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
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
                      <Field label="Building Type">
                        <PickOne
                          value={buildingType}
                          options={
                            (BUILDING_TYPES as readonly string[]).includes(buildingType)
                              ? BUILDING_TYPES
                              : [buildingType, ...BUILDING_TYPES]
                          }
                          onChange={setBuildingType}
                        />
                      </Field>
                    </div>
                  </LegacyGroup>
                  <LegacyGroup title="2. Labor &amp; Markup Setup">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span>
                        Labor: <span className="font-semibold">{money(laborRate)} per hour</span>
                      </span>
                      <span>
                        Markup:{" "}
                        <span className="font-semibold">
                          {markupMode === 1
                            ? `${money(markup)} per day`
                            : markupMode === 2
                              ? `${markup}% (Gross)`
                              : `${markup}%`}
                        </span>
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setShowLaborMarkup(true)}>
                        Click here to edit
                      </Button>
                    </div>
                  </LegacyGroup>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LegacyGroup title="3. Labor Template">
                      <PickOne
                        value={laborTemplateName || "None"}
                        options={laborTemplateOptions}
                        onChange={(v) => {
                          // Legacy cboTemplate_SelectedIndexChanged warning on an existing bid.
                          if (
                            bidId &&
                            laborTemplateName !== (v === "None" ? "" : v) &&
                            !window.confirm(
                              "Are you sure you want to change your labor template? This will override all manually entered labor settings.",
                            )
                          )
                            return;
                          setLaborTemplateName(v === "None" ? "" : v);
                        }}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Per-category labor modifiers (composed with the bid&apos;s adjust
                        percentages).
                      </p>
                    </LegacyGroup>
                    <LegacyGroup title="4. Estimator Commission">
                      <Field label="Commission Rate (%)">
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
                    <div className="flex flex-wrap items-end gap-4">
                      <label className="flex items-center gap-2 pb-2 text-xs">
                        <input
                          type="checkbox"
                          checked={taxExempt}
                          onChange={(e) => {
                            // Legacy chkTaxExempt_CheckedChanged: exempt → SalesTax 0 and the
                            // tax controls disabled; un-exempt → back to the company Settings.
                            const on = e.target.checked;
                            setTaxExempt(on);
                            if (on) setSalesTaxRate(0);
                            else {
                              setSalesTaxRate(null);
                              setTaxMaterialOnly(null);
                            }
                          }}
                        />
                        Tax Exempt
                      </label>
                      <Field label="Sales Tax (%)">
                        <Input
                          type="number"
                          step="0.01"
                          className="w-[120px]"
                          disabled={taxExempt}
                          value={
                            taxExempt ? "0.0" : Math.round(effSalesTaxRate * 100 * 10000) / 10000
                          }
                          onChange={(e) => setSalesTaxRate(num(e.target.value) / 100)}
                        />
                      </Field>
                      <label className="flex items-center gap-2 pb-2 text-xs">
                        <input
                          type="checkbox"
                          disabled={taxExempt}
                          checked={effTaxMaterialOnly}
                          onChange={(e) => setTaxMaterialOnly(e.target.checked)}
                        />
                        Only Tax Material
                      </label>
                      <span className="pb-2 text-xs text-muted-foreground">
                        {salesTaxRate === null && taxMaterialOnly === null
                          ? "Using Admin › General defaults for this bid."
                          : "Bid-level override (Admin › General is the default)."}
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
                  <LegacyGroup title="Client Information">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Company Name">
                        <Input
                          value={customer.name}
                          onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                        />
                      </Field>
                      <Field label="Contact Person">
                        <Input
                          value={customer.contact}
                          onChange={(e) => setCustomer((c) => ({ ...c, contact: e.target.value }))}
                        />
                      </Field>
                      <Field label="Address 1">
                        <Input
                          value={customer.clientAddress ?? ""}
                          onChange={(e) =>
                            setCustomer((c) => ({ ...c, clientAddress: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label="Address 2">
                        <Input
                          value={customer.clientAddress2 ?? ""}
                          onChange={(e) =>
                            setCustomer((c) => ({ ...c, clientAddress2: e.target.value }))
                          }
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="City St, Zip">
                          <div className="grid grid-cols-[minmax(0,1fr)_70px_110px] gap-2">
                            <Input
                              placeholder="City"
                              value={customer.clientCity ?? ""}
                              onChange={(e) =>
                                setCustomer((c) => ({ ...c, clientCity: e.target.value }))
                              }
                            />
                            <Input
                              placeholder="ST"
                              value={customer.clientState ?? ""}
                              onChange={(e) =>
                                setCustomer((c) => ({ ...c, clientState: e.target.value }))
                              }
                            />
                            <Input
                              placeholder="Zip"
                              value={customer.clientZip ?? ""}
                              onChange={(e) =>
                                setCustomer((c) => ({ ...c, clientZip: e.target.value }))
                              }
                            />
                          </div>
                        </Field>
                      </div>
                      <Field label="Phone x Ext">
                        <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
                          <Input
                            value={customer.phone ?? ""}
                            onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
                          />
                          <Input
                            placeholder="ext"
                            value={customer.phoneExt ?? ""}
                            onChange={(e) =>
                              setCustomer((c) => ({ ...c, phoneExt: e.target.value }))
                            }
                          />
                        </div>
                      </Field>
                      <Field label="Fax">
                        <Input
                          value={customer.fax ?? ""}
                          onChange={(e) => setCustomer((c) => ({ ...c, fax: e.target.value }))}
                        />
                      </Field>
                      <Field label="E-Mail">
                        <Input
                          value={customer.email ?? ""}
                          onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))}
                        />
                      </Field>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      The legacy client list (Edit Client Information) is not carried over; the
                      client lives on this bid.
                    </p>
                  </LegacyGroup>
                </TabsContent>
                <TabsContent value="jobsite" className="space-y-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() =>
                      // Legacy llbCopyClient: Address 1/2, City, State, Zip from the client.
                      setCustomer((c) => ({
                        ...c,
                        projectAddress: c.clientAddress ?? "",
                        projectAddress2: c.clientAddress2 ?? "",
                        jobCity: c.clientCity ?? "",
                        jobState: c.clientState ?? "",
                        jobZip: c.clientZip ?? "",
                        jobCityStZip: cityStZip(c.clientCity, c.clientState, c.clientZip),
                      }))
                    }
                  >
                    <Copy className="mr-1 h-3 w-3" /> Copy Client Address
                  </Button>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Address 1">
                      <Input
                        value={customer.projectAddress}
                        onChange={(e) =>
                          setCustomer((c) => ({ ...c, projectAddress: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Address 2">
                      <Input
                        value={customer.projectAddress2 ?? ""}
                        onChange={(e) =>
                          setCustomer((c) => ({ ...c, projectAddress2: e.target.value }))
                        }
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="City St, Zip">
                        {!customer.jobCity &&
                        !customer.jobState &&
                        !customer.jobZip &&
                        customer.jobCityStZip ? (
                          <Input
                            title="Older bid: combined city / state / zip line"
                            value={customer.jobCityStZip}
                            onChange={(e) =>
                              setCustomer((c) => ({ ...c, jobCityStZip: e.target.value }))
                            }
                          />
                        ) : (
                          <div className="grid grid-cols-[minmax(0,1fr)_70px_110px] gap-2">
                            {(
                              [
                                ["jobCity", "City"],
                                ["jobState", "ST"],
                                ["jobZip", "Zip"],
                              ] as const
                            ).map(([key, ph]) => (
                              <Input
                                key={key}
                                placeholder={ph}
                                value={customer[key] ?? ""}
                                onChange={(e) =>
                                  setCustomer((c) => {
                                    const nx = { ...c, [key]: e.target.value };
                                    return {
                                      ...nx,
                                      jobCityStZip: cityStZip(nx.jobCity, nx.jobState, nx.jobZip),
                                    };
                                  })
                                }
                              />
                            ))}
                          </div>
                        )}
                      </Field>
                    </div>
                    <Field label="Job #">
                      <Input
                        value={customer.jobNumber ?? ""}
                        onChange={(e) => setCustomer((c) => ({ ...c, jobNumber: e.target.value }))}
                      />
                    </Field>
                    <Field label="Ship Via">
                      <Input
                        value={customer.shipVia ?? ""}
                        onChange={(e) => setCustomer((c) => ({ ...c, shipVia: e.target.value }))}
                      />
                    </Field>
                    <Field label="Ship To">
                      <Input
                        value={customer.shipTo ?? ""}
                        onChange={(e) => setCustomer((c) => ({ ...c, shipTo: e.target.value }))}
                      />
                    </Field>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-base">Defaults</CardTitle>
                <CardDescription>
                  Manufacturer: Duro-Last. Used when adding new roof sections / parapets /
                  underlayment; existing items keep their values unless you apply.
                </CardDescription>
              </div>
              {frozenAsOf !== null && (
                <Button variant="outline" size="sm" onClick={refreshPricing}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Update Pricing &amp; Labor
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <LegacyGroup title="1. Deck Type">
                  <PickOne
                    value={sectionDefaults.deckType}
                    options={admin.deckOrder}
                    onChange={(v) => setSectionDefaults((p) => ({ ...p, deckType: v }))}
                  />
                </LegacyGroup>
                <LegacyGroup title="2. Wall Type">
                  <PickOne
                    value={parapetDefaults.wallType === 4 ? "Brick or Concrete" : "Wood or Metal"}
                    options={["Wood or Metal", "Brick or Concrete"]}
                    onChange={(v) =>
                      setParapetDefaults((p) => ({
                        ...p,
                        wallType: v === "Brick or Concrete" ? 4 : 1,
                      }))
                    }
                  />
                </LegacyGroup>
              </div>
              <LegacyGroup title="3. Roof Sections Material">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Roof System">
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
                  <Field label="Attached With">
                    <Select
                      value={attachment}
                      onValueChange={(v) => setAttachment(v as "mechanical" | "adhered")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mechanical">Mechanically Fastened</SelectItem>
                        <SelectItem value="adhered">(No Tab) Fully Adhered</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {attachment === "adhered" && (
                    <Field label="Attached To">
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
                  <Field label="Design Table (psf)">
                    <PickOne
                      value={String(sectionDefaults.designTable ?? 60)}
                      options={DESIGN_TABLE_OPTIONS.map(String)}
                      onChange={(v) =>
                        setSectionDefaults((p) => ({ ...p, designTable: Number(v) }))
                      }
                    />
                  </Field>
                  <Field label="Avg Sheet Size">
                    <PickOne
                      value={sectionDefaults.sheetSizeLabel}
                      options={sheetSizeOptions}
                      onChange={(v) => setSectionDefaults((p) => ({ ...p, sheetSizeLabel: v }))}
                    />
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sections.length === 0}
                    onClick={() => setConfirmApplySections(true)}
                  >
                    Apply To Existing Roof Sections
                  </Button>
                  {defaultsEnhancement && (
                    <span className="text-xs font-medium text-destructive">
                      {defaultsEnhancement}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Per-section perimeter &amp; enhancement lives on the Sections step.
                  </span>
                </div>
              </LegacyGroup>
              <LegacyGroup title="4. Underlayment Attached With">
                <div className="flex flex-wrap items-center gap-3">
                  <PickOne
                    value={
                      underlaymentAttachmentDefault === "none"
                        ? "None"
                        : underlaymentAttachmentDefault === "adhesive"
                          ? "Adhesive"
                          : "Mechanically Fastened"
                    }
                    options={["None", "Mechanically Fastened", "Adhesive"]}
                    onChange={(v) => {
                      const next =
                        v === "None" ? "none" : v === "Adhesive" ? "adhesive" : "mechanical";
                      setUnderlaymentAttachmentDefault(next);
                      if (next !== "none") setUAttach(next);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    (will not apply to existing underlayment)
                  </span>
                </div>
              </LegacyGroup>
              <LegacyGroup title="5. Parapets Material">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Roof System">
                    <Input
                      value={roofSystem}
                      disabled
                      title="Parapets follow the bid roof system"
                    />
                  </Field>
                  <Field label="Attached With">
                    <Input
                      value={
                        attachment === "adhered"
                          ? "(No Tab) Fully Adhered"
                          : "Mechanically Fastened"
                      }
                      disabled
                    />
                  </Field>
                  <Field label="Type">
                    <PickOne
                      value={
                        parapetDefaults.thicknessMil !== undefined
                          ? String(parapetDefaults.thicknessMil)
                          : "Bid default"
                      }
                      options={["Bid default", "40", "50", "60"]}
                      onChange={(v) =>
                        setParapetDefaults((p) => {
                          const nx = { ...p };
                          if (v === "Bid default") delete nx.thicknessMil;
                          else nx.thicknessMil = Number(v);
                          return nx;
                        })
                      }
                    />
                  </Field>
                  <Field label="Color">
                    <PickOne
                      value={parapetDefaults.color ?? "Bid default"}
                      options={["Bid default", ...colorOptions]}
                      onChange={(v) =>
                        setParapetDefaults((p) => {
                          const nx = { ...p };
                          if (v === "Bid default") delete nx.color;
                          else nx.color = v;
                          return nx;
                        })
                      }
                    />
                  </Field>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={parapets.length === 0}
                  onClick={() =>
                    // Legacy Button1_Click_1: membrane type + color onto every present parapet.
                    setParapets((prev) =>
                      prev.map((pp) => {
                        const nx: ParapetInput = {
                          ...pp,
                          ...(parapetDefaults.wallType !== undefined
                            ? { wallType: parapetDefaults.wallType }
                            : {}),
                        };
                        if (parapetDefaults.thicknessMil !== undefined)
                          nx.thicknessMil = parapetDefaults.thicknessMil;
                        else delete nx.thicknessMil;
                        if (parapetDefaults.color) nx.color = parapetDefaults.color;
                        else delete nx.color;
                        return nx;
                      }),
                    )
                  }
                >
                  Apply to Existing Parapets
                </Button>
              </LegacyGroup>
              <LegacyGroup title="6. Select Type of Warranty">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Warranty">
                    <PickOne
                      value={warrantyName || "None"}
                      options={warrantyOptions}
                      onChange={(v) => setWarrantyName(v === "None" ? "" : v)}
                    />
                  </Field>
                  <Field label="Max Expected Wind">
                    <PickOne
                      value={
                        MAX_WIND_OPTIONS.find((o) => o.band === effHighWind?.band)?.label ?? "—"
                      }
                      options={["—", ...MAX_WIND_OPTIONS.map((o) => o.label)]}
                      disabled={!effHighWind?.isHighWind}
                      onChange={(v) =>
                        setMaxWindExpected(MAX_WIND_OPTIONS.find((o) => o.label === v)?.value)
                      }
                    />
                  </Field>
                </div>
                {effHighWind?.isHighWind && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    High-wind warranty ({effHighWind.termYears} yr): the upcharge follows the Max
                    Expected Wind band and the attachment.
                  </p>
                )}
                {thinSections.length > 0 && (
                  <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    <p>
                      This warranty requires {selectedWarranty!.reqThickness} mil membrane;{" "}
                      {thinSections.map((sec) => sec.name).join(", ")}{" "}
                      {thinSections.length === 1 ? "is" : "are"} thinner.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1 h-7"
                      onClick={() =>
                        setSections((prev) =>
                          prev.map((sec) =>
                            sec.thickness < selectedWarranty!.reqThickness!
                              ? { ...sec, thickness: selectedWarranty!.reqThickness! }
                              : sec,
                          ),
                        )
                      }
                    >
                      Use These Thicknesses
                    </Button>
                  </div>
                )}
              </LegacyGroup>
              <div className="flex justify-end">
                <Button onClick={() => goStep(1)}>Start!</Button>
              </div>
            </CardContent>
          </Card>

          {/* Legacy frmLaborTemplate ("Edit Markup & Labor") */}
          <Dialog open={showLaborMarkup} onOpenChange={setShowLaborMarkup}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Markup &amp; Labor</DialogTitle>
              </DialogHeader>
              <p className="text-xs text-muted-foreground">
                Select an option to copy from and/or manually specify this bid&apos;s labor rate and
                markup.
              </p>
              <div className="space-y-3 text-sm">
                {(presets?.length ?? 0) > 0 && (
                  <Field label="Available Markup &amp; Labor options">
                    <Select value={presetName} onValueChange={applyPreset}>
                      <SelectTrigger>
                        <SelectValue placeholder="Copy from…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(presets ?? []).map((pr) => (
                          <SelectItem key={pr.name} value={pr.name}>
                            {pr.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Hourly Labor">
                    <Input
                      type="number"
                      step="0.01"
                      value={laborRate}
                      onChange={(e) => setLaborRate(num(e.target.value))}
                    />
                  </Field>
                  <Field label="Hours per Man Day">
                    <Input value={admin.settings.hoursPerDay} disabled />
                  </Field>
                  <Field label="Man-Day Labor">
                    <Input
                      type="number"
                      step="0.01"
                      value={Math.round(laborRate * admin.settings.hoursPerDay * 100) / 100}
                      onChange={(e) =>
                        admin.settings.hoursPerDay > 0 &&
                        setLaborRate(num(e.target.value) / admin.settings.hoursPerDay)
                      }
                    />
                  </Field>
                </div>
                <div className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-semibold">Markup</p>
                  <div className="space-y-1 text-xs">
                    {(
                      [
                        [0, "Percentage of Total Costs"],
                        [1, "Dollars per Man Day"],
                        [2, "Gross Profit Percentage"],
                      ] as Array<[MarkupMode, string]>
                    ).map(([m, label]) => (
                      <label key={m} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="markup-mode"
                          checked={markupMode === m}
                          onChange={() => setMarkupMode(m)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex items-end gap-3">
                    <Field label={markupMode === 1 ? "Markup ($ per man day)" : "Markup (%)"}>
                      <Input
                        type="number"
                        className="w-[140px]"
                        value={markup}
                        onChange={(e) => setMarkup(num(e.target.value))}
                      />
                    </Field>
                    <p className="pb-2 text-xs text-muted-foreground">
                      {markupMode === 1
                        ? "Adds X dollars to the bid for each man day calculated."
                        : markupMode === 2
                          ? "Price = cost ÷ (1 − markup%)."
                          : "Price = cost × (1 + markup%)."}
                    </p>
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-semibold">Include prior to Markup</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={commissionInMarkup}
                        onChange={(e) => setCommissionInMarkup(e.target.checked)}
                      />
                      Commission
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={perDiemInMarkup}
                        onChange={(e) => setPerDiemInMarkup(e.target.checked)}
                      />
                      Per Diem
                    </label>
                    <Field label="Per Diem ($/man-day)">
                      <Input
                        type="number"
                        className="h-8 w-[120px]"
                        value={perDiem}
                        onChange={(e) => setPerDiem(num(e.target.value))}
                      />
                    </Field>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setShowLaborMarkup(false)}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Legacy Button1_Click: "Pressing OK will apply these Material Defaults to ALL
              existing Roof Sections - Roof System, Design Table, Membrane Type, Color" */}
          <AlertDialog open={confirmApplySections} onOpenChange={setConfirmApplySections}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Apply To Existing Roof Sections</AlertDialogTitle>
                <AlertDialogDescription>
                  Pressing OK will apply these Material Defaults to ALL existing Roof Sections: Roof
                  System, Attached With, Design Table, Membrane Type, Color.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    setSections((prev) =>
                      prev.map((sec) => {
                        // Roof System / Attached With / adhesive: clear the per-section
                        // overrides so the bid defaults apply (legacy OverwriteWithDefault).
                        const nx = { ...sec };
                        delete nx.roofSystem;
                        delete nx.attachment;
                        delete nx.membraneAdhesiveName;
                        return {
                          ...nx,
                          designTable: sectionDefaults.designTable ?? 60,
                          thickness: sectionDefaults.thickness,
                          color: sectionDefaults.color,
                        };
                      }),
                    )
                  }
                >
                  OK
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className={step === 1 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Roof Sections</CardTitle>
              <CardDescription>
                The legacy Roof Section screen: dimensions, deck, system / attachment, sheet size or
                complexity, and the Edge Options (perimeter edges + corners, terminations, ARP, wood
                blocking) per side.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SectionsScreen
                sections={sections}
                onChange={setSections}
                selected={selSection}
                onSelect={setSelSection}
                admin={admin}
                bidDefaults={{ roofSystem, attachment, membraneAdhesiveName: membraneAdhesive }}
                colorOptions={colorOptions}
                fastenerLookup={fastenerLookup}
                stdSizeDiscount={stdSizeDiscount}
                onStdSizeDiscount={setStdSizeDiscount}
                bidAdjustLaborPct={adjustLaborPct}
                crewRate={laborRate}
                totals={
                  result
                    ? {
                        sectionHours: result.sectionHours,
                        setupHours: result.r.setupHours,
                        inspectionHours: result.r.inspectionHours,
                        roofSqFt: result.r.roofSqFootage,
                        membraneSqFt: result.r.sqFtTotalMembrane,
                      }
                    : null
                }
                newSection={() => newSection({ ...sectionDefaults })}
                onGoUnderlayment={(id) => {
                  setUSel([id]);
                  goStep(2);
                }}
                onGoTearOff={() => goStep(7)}
              />
            </CardContent>
          </Card>
        </div>

        {/* Legacy Underlayment / Insulation screen: select sections, configure a layer, apply. */}
        <div className={step === 2 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Underlayment / Insulation</CardTitle>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Select roof section(s) or:</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUSel(sections.map((s) => s.id))}
                >
                  Select all sections
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>W × L</TableHead>
                      {[1, 2, 3, 4].map((n) => (
                        <TableHead key={n}>Layer {n} : Attachment</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections.map((s) => {
                      const sLayers = sectionLayers(s);
                      const sel = uSel.includes(s.id);
                      return (
                        <TableRow
                          key={s.id}
                          onClick={() =>
                            setUSel((prev) =>
                              prev.includes(s.id)
                                ? prev.filter((x) => x !== s.id)
                                : [...prev, s.id],
                            )
                          }
                          className={sel ? "cursor-pointer bg-primary/15" : "cursor-pointer"}
                        >
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell className="tabular-nums">
                            {s.width}x{s.length}
                          </TableCell>
                          {[0, 1, 2, 3].map((li) => {
                            const l = sLayers[li];
                            return (
                              <TableCell key={li} className="whitespace-nowrap text-xs">
                                {l
                                  ? l.quote
                                    ? `${l.board} : quote “${l.quote.name}”`
                                    : `${l.board} : ${
                                        l.attachment === "mechanical"
                                          ? `Mech (${l.fastenersPerBoard || 5}/bd)`
                                          : l.adhesiveName || "Adhesive"
                                      }`
                                  : "None : None"}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-4 text-xs">
                <span>
                  Sq Ft to cover:{" "}
                  <span className="font-semibold tabular-nums">
                    {sections
                      .filter((s) => uSel.includes(s.id))
                      .reduce((sum, s) => sum + s.length * s.width, 0)
                      .toLocaleString()}
                  </span>
                </span>
                <span>
                  Man hours (bid):{" "}
                  <span className="font-semibold tabular-nums">
                    {(result?.r.underlaymentLaborHours ?? 0).toFixed(2)}
                  </span>
                </span>
                <span>
                  Labor cost:{" "}
                  <span className="font-semibold tabular-nums">
                    {money((result?.r.underlaymentLaborHours ?? 0) * laborRate)}
                  </span>
                </span>
              </div>

              <div className="grid items-start gap-4 lg:grid-cols-2">
                {/* Layer tabs + stack visual (legacy bottom-left) */}
                <div className="rounded-md border">
                  <div className="flex border-b">
                    {[0, 1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setUTab(n)}
                        className={`px-3 py-1.5 text-xs font-medium ${
                          uTab === n
                            ? "border-b-2 border-primary text-primary"
                            : "text-muted-foreground"
                        }`}
                      >
                        Add Layer {n + 1}
                      </button>
                    ))}
                  </div>
                  <div className="p-4">
                    {(() => {
                      const stackSec = sections.find((s) => uSel.includes(s.id)) ?? sections[0];
                      const stackLayers = stackSec ? sectionLayers(stackSec) : [];
                      return (
                        <div className="mx-auto w-64 space-y-1">
                          {[3, 2, 1, 0].map((li) => {
                            const l = stackLayers[li];
                            return (
                              <div
                                key={li}
                                className={`flex min-h-8 flex-col items-center justify-center rounded-sm border px-1 py-0.5 text-[11px] ${
                                  li === uTab ? "ring-2 ring-primary" : ""
                                } ${
                                  l
                                    ? "bg-amber-100 font-medium dark:bg-amber-300/20"
                                    : "border-dashed text-muted-foreground"
                                }`}
                              >
                                <span className="truncate">
                                  {l ? `Layer ${li + 1}: ${l.board}` : `Layer ${li + 1}`}
                                </span>
                                {l?.quote && (
                                  <span className="max-w-full truncate text-[10px] font-normal text-muted-foreground">
                                    “{l.quote.name}” —{" "}
                                    {money(
                                      l.quote.pieceMode
                                        ? (l.quote.pieces ?? 0) * (l.quote.costPerPiece ?? 0)
                                        : (l.quote.lumpSum ?? 0),
                                    )}{" "}
                                    + {l.quote.laborAmount ?? 0}
                                    {l.quote.laborInDays ? "d" : "h"} labor
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          <div className="flex h-8 items-center justify-center rounded-sm bg-blue-500/80 text-[11px] font-semibold text-white">
                            Deck{stackSec ? ` (${stackSec.deckType})` : ""}
                          </div>
                          <p className="pt-1 text-center text-[11px] text-muted-foreground">
                            {stackSec ? `Showing ${stackSec.name}` : "Add a section first"}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Insulation type + attachment (legacy bottom-right): parent tiles → that
                    parent's board options, mirroring the legacy Select Insulation Type panel. */}
                <div className="space-y-3 rounded-md border p-4">
                  <p className="text-xs font-semibold">Select insulation type</p>
                  {(() => {
                    const ug = admin.underlaymentGroups;
                    if (!ug || ug.groups.length === 0) {
                      // Older admin snapshot without the grouping tables: keep the flat list.
                      return (
                        <div className="flex flex-wrap gap-2">
                          {boardOptions.map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => setUBoard(b)}
                              className={`rounded-md border px-2.5 py-2 text-xs ${
                                uBoard === b
                                  ? "border-primary bg-primary/10 font-medium"
                                  : "hover:bg-muted"
                              }`}
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      );
                    }
                    // Priced boards the mapping doesn't know (admin-added later) stay reachable
                    // under a catch-all "Other" tile (id -1).
                    const ungrouped = boardOptions.filter((b) => !(b in (ug.groupIdByBoard ?? {})));
                    const groups = ungrouped.length
                      ? [...ug.groups, { id: -1, name: "Other", boards: ungrouped }]
                      : ug.groups;
                    const activeGroup =
                      uGroup ??
                      (uBoard ? (ug.groupIdByBoard?.[uBoard] ?? -1) : undefined) ??
                      groups[0]!.id;
                    const boards = groups.find((g) => g.id === activeGroup)?.boards ?? [];
                    return (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {groups.map((g) => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => {
                                setUGroup(g.id);
                                if (uBoard && (ug.groupIdByBoard?.[uBoard] ?? -1) !== g.id)
                                  setUBoard("");
                              }}
                              className={`rounded-md border px-3 py-2 text-xs ${
                                activeGroup === g.id
                                  ? "border-primary bg-primary/10 font-semibold"
                                  : "hover:bg-muted"
                              }`}
                            >
                              {g.name}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 border-t pt-2">
                          {boards.map((b) =>
                            ug.needQuoteByBoard?.[b] ? (
                              // Legacy NeedQuote entry: opens the quote dialog (docs §10.5).
                              <button
                                key={b}
                                type="button"
                                onClick={() => openQuoteDialog(b)}
                                className="rounded-md border border-dashed px-2.5 py-1.5 text-xs italic hover:bg-muted"
                              >
                                {b} …
                              </button>
                            ) : (
                              <button
                                key={b}
                                type="button"
                                onClick={() => setUBoard(b)}
                                className={`rounded-md border px-2.5 py-1.5 text-xs ${
                                  uBoard === b
                                    ? "border-primary bg-primary/10 font-medium"
                                    : "hover:bg-muted"
                                }`}
                              >
                                {b}
                              </button>
                            ),
                          )}
                        </div>
                      </>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground">
                    Underlayment price per sq ft:{" "}
                    <span className="font-semibold tabular-nums">
                      {(admin.underlaymentPrices?.[uBoard] ?? 0).toFixed(2)}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Field label="Attachment method">
                      <PickOne
                        value={uAttach}
                        options={["mechanical", "adhesive"]}
                        onChange={(v) => setUAttach(v as "mechanical" | "adhesive")}
                      />
                    </Field>
                    {uAttach === "mechanical" ? (
                      <Field label="Fasteners / 4×8 board">
                        <PickOne
                          value={String(uFast || fastenerOptions[0] || 5)}
                          options={fastenerOptions.map(String)}
                          onChange={(v) => setUFast(Number(v))}
                        />
                      </Field>
                    ) : (
                      <>
                        <Field label="Adhesive">
                          <PickOne
                            value={uAdh}
                            options={adhesiveOptions}
                            onChange={(v) => {
                              setUAdh(v);
                              setUSub("");
                            }}
                          />
                        </Field>
                        <Field label="Substrate">
                          <PickOne
                            value={uSub}
                            options={substratesFor(uAdh)}
                            onChange={(v) => setUSub(v)}
                          />
                        </Field>
                        <Field label="Quote containers (over tapered)">
                          <NumInput min={0} value={uQAU} onValue={setUQAU} />
                        </Field>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={!uBoard || uSel.length === 0}
                      onClick={() =>
                        setSections((prev) =>
                          prev.map((s) => {
                            if (!uSel.includes(s.id)) return s;
                            const nextLayers = [...sectionLayers(s)];
                            const idx = Math.min(uTab, nextLayers.length);
                            nextLayers[idx] = {
                              board: uBoard,
                              attachment: uAttach,
                              fastenersPerBoard:
                                uAttach === "mechanical" ? uFast || fastenerOptions[0] || 5 : 0,
                              adhesiveName: uAttach === "adhesive" ? uAdh : "",
                              substrate: uAttach === "adhesive" ? uSub : "",
                              // §10.7: containers billed verbatim when this layer sits over a
                              // tapered/crickets-group board (engine checks the group).
                              ...(uAttach === "adhesive" && uQAU > 0
                                ? { quoteAdhesiveUnits: uQAU }
                                : {}),
                            };
                            return { ...s, layers: nextLayers, underlaymentBoard: "" };
                          }),
                        )
                      }
                    >
                      Apply layer {uTab + 1} to selected
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uSel.length === 0}
                      onClick={() =>
                        setSections((prev) =>
                          prev.map((s) =>
                            uSel.includes(s.id)
                              ? {
                                  ...s,
                                  layers: sectionLayers(s).filter((_, j) => j !== uTab),
                                  underlaymentBoard: "",
                                }
                              : s,
                          ),
                        )
                      }
                    >
                      None (clear layer {uTab + 1})
                    </Button>
                  </div>
                  {/* Legacy Enhancement Options (frmUnderlaymentAdv, docs §10.3): custom
                      mechanical fastener densities per zone + custom adhesive ribbon spacing,
                      stored per SECTION like legacy. */}
                  <div className="border-t pt-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="text-xs font-medium text-primary underline underline-offset-2"
                        onClick={() => setUEnhOpen((v) => !v)}
                      >
                        Enhancement Options
                      </button>
                      {sections.some(
                        (s) =>
                          uSel.includes(s.id) &&
                          (s.uCustomFastenerDensity || (s.uAdhesiveSpacingIn ?? 0) > 0),
                      ) && (
                        <span className="text-[11px] font-medium text-green-600">
                          ← Using Custom Enhancement
                        </span>
                      )}
                    </div>
                    {uEnhOpen && (
                      <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="uenh-fast"
                            checked={uEnhFasteners}
                            onCheckedChange={setUEnhFasteners}
                          />
                          <Label htmlFor="uenh-fast" className="text-xs">
                            Custom mechanical fastening (fasteners per sq ft, by zone)
                          </Label>
                        </div>
                        {uEnhFasteners && (
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                ["Field", uEnhField, setUEnhField],
                                ["Perimeter", uEnhPerim, setUEnhPerim],
                                ["Corner", uEnhCorner, setUEnhCorner],
                              ] as const
                            ).map(([label, val, set]) => (
                              <Field key={label} label={`${label} (/sq ft)`}>
                                <NumInput min={0} value={val} onValue={set} />
                                <p className="pt-0.5 text-[10px] text-muted-foreground">
                                  ≈ {(val * 32).toFixed(1)} per 4×8 board
                                </p>
                              </Field>
                            ))}
                          </div>
                        )}
                        <Field label="Custom adhesive ribbon spacing (in; 0 = default)">
                          <NumInput min={0} value={uEnhSpacing} onValue={setUEnhSpacing} />
                        </Field>
                        <p className="text-[10px] text-muted-foreground">
                          Adhesive units are multiplied by 12 ÷ spacing (legacy §10.3); fastener
                          counts become Round(density × zone area) per zone.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={uSel.length === 0}
                            onClick={() =>
                              setSections((prev) =>
                                prev.map((s) => {
                                  if (!uSel.includes(s.id)) return s;
                                  const nx = { ...s };
                                  if (uEnhFasteners)
                                    nx.uCustomFastenerDensity = {
                                      field: uEnhField,
                                      perim: uEnhPerim,
                                      corner: uEnhCorner,
                                    };
                                  else delete nx.uCustomFastenerDensity;
                                  if (uEnhSpacing > 0) nx.uAdhesiveSpacingIn = uEnhSpacing;
                                  else delete nx.uAdhesiveSpacingIn;
                                  return nx;
                                }),
                              )
                            }
                          >
                            Apply enhancement to selected
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={uSel.length === 0}
                            onClick={() =>
                              setSections((prev) =>
                                prev.map((s) => {
                                  if (!uSel.includes(s.id)) return s;
                                  const nx = { ...s };
                                  delete nx.uCustomFastenerDensity;
                                  delete nx.uAdhesiveSpacingIn;
                                  return nx;
                                }),
                              )
                            }
                          >
                            Clear enhancement
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Pick sections above, choose a board and attachment, then apply. Layers bill
                    board $/sqft × area × 1.06 waste plus their layout/fastener or adhesive labor.
                    Dashed entries require a quote (legacy) — clicking one opens the quote form.
                  </p>
                  {/* Custom-quote dialog — mirrors the captured legacy HandleFluteFiller form
                      (docs §10.5): quote name, labor hours/days, lump-sum vs per-piece. */}
                  <Dialog
                    open={uQuoteBoard !== null}
                    onOpenChange={(open) => {
                      if (!open) setUQuoteBoard(null);
                    }}
                  >
                    <DialogContent className="max-w-xl">
                      <DialogHeader>
                        <DialogTitle>{uQuoteBoard}</DialogTitle>
                      </DialogHeader>
                      {(() => {
                        const sf = sections
                          .filter((s) => uSel.includes(s.id))
                          .reduce((sum, s) => sum + s.length * s.width, 0);
                        const material = qPieceMode ? qPieces * qCpp : qLump;
                        const hours = qLaborDays
                          ? qLabor * (admin?.settings.hoursPerDay ?? 9)
                          : qLabor;
                        const preview = material + hours * laborRate;
                        return (
                          <div className="space-y-3 text-sm">
                            {uQuoteBoard === "Flute Filler" ? (
                              <p className="text-xs text-muted-foreground">
                                Since you have selected Flute Filler you will need to obtain a quote
                                before you can finalize your bid. When you have your quote you will
                                need to furnish the following information to complete your bid. If
                                using wood blocking on any of these sections, you will have to
                                manually enter the required amounts on the Non-D/L screen.
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                This selection requires a quote. Enter the quoted material and labor
                                to complete your bid.
                              </p>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                              <Field label="S.F of Sections">
                                <Input value={sf.toFixed(2)} readOnly disabled />
                              </Field>
                              <Field label="Quote name">
                                <Input value={qName} onChange={(e) => setQName(e.target.value)} />
                              </Field>
                            </div>
                            {uQuoteBoard !== null && existingQuoteFor(uQuoteBoard) && (
                              /* frmQuoteDecision (§10.7): merge sums LumpSum + labor hours. */
                              <div className="flex items-center gap-4 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                                <span>A quote already exists on this layer:</span>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="radio"
                                    checked={qMerge}
                                    onChange={() => setQMerge(true)}
                                  />
                                  Merge (add amounts)
                                </label>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="radio"
                                    checked={!qMerge}
                                    onChange={() => setQMerge(false)}
                                  />
                                  Start new quote
                                </label>
                              </div>
                            )}
                            {uQuoteBoard === "Flute Filler" && (
                              /* frmFluteFillerCalc (§10.7, verbatim formula): a helper that
                                 fills Pieces; the quote bills whatever lands there. */
                              <div className="rounded-md border p-3">
                                <p className="pb-1 text-xs font-medium">Calculate pieces</p>
                                <div className="grid grid-cols-4 items-end gap-2">
                                  <Field label="Piece length (ft)">
                                    <NumInput min={0} value={qFfLen} onValue={setQFfLen} />
                                  </Field>
                                  <Field label="Ridge-to-ridge (in)">
                                    <NumInput min={0} value={qFfR2R} onValue={setQFfR2R} />
                                  </Field>
                                  <Field label="Waste %">
                                    <NumInput min={0} value={qFfPlus} onValue={setQFfPlus} />
                                  </Field>
                                  {(() => {
                                    const calc = fluteFillerPieces({
                                      sections: sections
                                        .filter((x) => uSel.includes(x.id))
                                        .map((x) => ({ widthFt: x.width })),
                                      pieceLengthFt: qFfLen,
                                      ridgeToRidgeIn: qFfR2R,
                                      wastePct: qFfPlus,
                                    });
                                    return (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setQPieceMode(true);
                                          setQPieces(
                                            qFfPlus > 0 ? calc.piecesWithWaste : calc.pieces,
                                          );
                                        }}
                                      >
                                        Use {qFfPlus > 0 ? calc.piecesWithWaste : calc.pieces}
                                        {qFfPlus > 0 ? ` (${calc.pieces} + waste)` : ""}
                                      </Button>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}
                            <div className="rounded-md border p-3">
                              <p className="pb-1 text-xs font-medium">Labor</p>
                              <div className="flex items-end gap-3">
                                <Field label="Total amount">
                                  <NumInput min={0} value={qLabor} onValue={setQLabor} />
                                </Field>
                                <div className="flex items-center gap-3 pb-1 text-xs">
                                  <label className="flex items-center gap-1">
                                    <input
                                      type="radio"
                                      checked={!qLaborDays}
                                      onChange={() => setQLaborDays(false)}
                                    />
                                    Hours
                                  </label>
                                  <label className="flex items-center gap-1">
                                    <input
                                      type="radio"
                                      checked={qLaborDays}
                                      onChange={() => setQLaborDays(true)}
                                    />
                                    Days
                                  </label>
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div
                                className={`rounded-md border p-3 ${qPieceMode ? "opacity-60" : ""}`}
                              >
                                <label className="flex items-center gap-1 pb-1 text-xs font-medium">
                                  <input
                                    type="radio"
                                    checked={!qPieceMode}
                                    onChange={() => setQPieceMode(false)}
                                  />
                                  Lump Sum Quote
                                </label>
                                <Field label="Total amount ($)">
                                  <NumInput min={0} value={qLump} onValue={setQLump} />
                                </Field>
                              </div>
                              <div
                                className={`rounded-md border p-3 ${qPieceMode ? "" : "opacity-60"}`}
                              >
                                <label className="flex items-center gap-1 pb-1 text-xs font-medium">
                                  <input
                                    type="radio"
                                    checked={qPieceMode}
                                    onChange={() => setQPieceMode(true)}
                                  />
                                  Piece Quote
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <Field label="Pieces">
                                    <NumInput min={0} value={qPieces} onValue={setQPieces} />
                                  </Field>
                                  <Field label="Cost per piece ($)">
                                    <NumInput min={0} value={qCpp} onValue={setQCpp} />
                                  </Field>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm font-semibold">
                              Material &amp; Labor Cost: ${preview.toFixed(2)}
                            </p>
                            {uSel.length === 0 && (
                              <p className="text-xs text-destructive">
                                Select at least one roof section above first.
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setUQuoteBoard(null)}>
                          Cancel
                        </Button>
                        <Button
                          disabled={uSel.length === 0}
                          onClick={() => {
                            const board = uQuoteBoard!;
                            // One QuoteUL shared across the selection: the same id bills ONCE
                            // (§10.7 dedup). Merge sums LumpSum + labor hours (days converted
                            // × hours-per-man-day), like frmQuoteDecision's merge path.
                            type Q = NonNullable<UnderlaymentLayer["quote"]>;
                            const hpd = admin?.settings.hoursPerDay ?? 9;
                            const norm = (q: Q) =>
                              q.laborInDays ? (q.laborAmount ?? 0) * hpd : (q.laborAmount ?? 0);
                            const lumpOf = (q: Q) =>
                              q.pieceMode
                                ? (q.pieces ?? 0) * (q.costPerPiece ?? 0)
                                : (q.lumpSum ?? 0);
                            const entered: Q = {
                              name: qName,
                              ...(qPieceMode
                                ? { pieceMode: true, pieces: qPieces, costPerPiece: qCpp }
                                : { lumpSum: qLump }),
                              laborAmount: qLabor,
                              ...(qLaborDays ? { laborInDays: true } : {}),
                            };
                            const existing = existingQuoteFor(board);
                            const quote: Q =
                              existing && qMerge
                                ? {
                                    id: existing.id ?? crypto.randomUUID(),
                                    name: existing.name,
                                    lumpSum: lumpOf(existing) + lumpOf(entered),
                                    laborAmount: norm(existing) + norm(entered),
                                  }
                                : { id: crypto.randomUUID(), ...entered };
                            setSections((prev) =>
                              prev.map((s) => {
                                if (!uSel.includes(s.id)) return s;
                                const nextLayers = [...sectionLayers(s)];
                                const idx = Math.min(uTab, nextLayers.length);
                                nextLayers[idx] = {
                                  board,
                                  attachment: "mechanical",
                                  fastenersPerBoard: 0,
                                  adhesiveName: "",
                                  substrate: "",
                                  quote,
                                };
                                return { ...s, layers: nextLayers, underlaymentBoard: "" };
                              }),
                            );
                            setUQuoteBoard(null);
                          }}
                        >
                          Ok
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className={step === 3 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Parapets</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setParapets((p) => [
                    ...p,
                    newParapet({
                      heightBand: admin.parapetLabor?.bands[0] ?? "",
                      wallType: parapetDefaults.wallType ?? 1,
                      ...(parapetDefaults.thicknessMil !== undefined
                        ? { thicknessMil: parapetDefaults.thicknessMil }
                        : {}),
                      ...(parapetDefaults.color ? { color: parapetDefaults.color } : {}),
                    }),
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
                            <NumInput
                              value={p.lengthFt}
                              onValue={(n) =>
                                setParapets((prev) =>
                                  prev.map((x, j) => (j === i ? { ...x, lengthFt: n } : x)),
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
                            <NumInput
                              min={0}
                              value={p.pieces ?? 1}
                              onValue={(n) =>
                                setParapets((prev) =>
                                  prev.map((x, j) => (j === i ? { ...x, pieces: n } : x)),
                                )
                              }
                            />
                          </Field>
                          {/* Legacy §8.5: the labor drill column keys WallType (mech; adhered is
                              always pre-drill) and the cant column keys Cant > 0 — both derived,
                              so no toggles. Manual switches appear only for legacy walls saved
                              without those fields. */}
                          {(() => {
                            const hasDims =
                              p.skirtInches !== undefined ||
                              p.cantInches !== undefined ||
                              p.verticalInches !== undefined ||
                              p.wallTopInches !== undefined ||
                              p.dropInches !== undefined;
                            const hasWallType = p.wallType !== undefined;
                            const predrill = hasWallType
                              ? attachment !== "mechanical" || p.wallType === 4
                              : p.predrill;
                            const canted = hasDims ? (p.cantInches ?? 0) > 0 : p.canted;
                            if (hasDims && hasWallType) {
                              return (
                                <p
                                  className="self-end pb-1 text-[11px] text-muted-foreground"
                                  title="Legacy labor columns: pre-drill follows Wall Type (adhered bids always pre-drill); canted follows the Cant dimension."
                                >
                                  Labor: {predrill ? "pre-drill" : "no-drill"}
                                  {canted ? ", canted" : ""}
                                </p>
                              );
                            }
                            return (
                              <>
                                {!hasWallType && (
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
                                )}
                                {!hasDims && (
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
                                )}
                                {(hasDims || hasWallType) && (
                                  <p className="self-end pb-1 text-[11px] text-muted-foreground">
                                    Labor: {predrill ? "pre-drill" : "no-drill"}
                                    {canted ? ", canted" : ""}
                                  </p>
                                )}
                              </>
                            );
                          })()}
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
                            ["Top of Wall", "wallTopInches"],
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
                                    <NumInput
                                      min={0}
                                      value={p[key] ?? 0}
                                      onValue={(n) => setDim(key, n)}
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
                        {/* Legacy Membrane Options + flags (docs §8.5/§8.6): the parapet's OWN
                            mil/color price its membrane; Use Slipsheet adds poly labor; the
                            labor %% mirrors the legacy per-item labor link. */}
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Membrane options
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Field label="Mil">
                              <PickOne
                                value={
                                  p.thicknessMil !== undefined
                                    ? `${p.thicknessMil}mil`
                                    : "Bid default"
                                }
                                options={["Bid default", "40mil", "50mil", "60mil"]}
                                onChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => {
                                      if (j !== i) return x;
                                      const nx = { ...x };
                                      if (v === "Bid default") delete nx.thicknessMil;
                                      else nx.thicknessMil = parseInt(v, 10);
                                      return nx;
                                    }),
                                  )
                                }
                              />
                            </Field>
                            <Field label="Color">
                              <PickOne
                                value={p.color ?? "Bid default"}
                                options={["Bid default", ...colorOptions]}
                                onChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => {
                                      if (j !== i) return x;
                                      const nx = { ...x };
                                      if (v === "Bid default") delete nx.color;
                                      else nx.color = v;
                                      return nx;
                                    }),
                                  )
                                }
                              />
                            </Field>
                            <Field label="Labor adj (%)">
                              <NumInput
                                min={-100}
                                value={p.adjustLaborPct ?? 0}
                                onValue={(n) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => (j === i ? { ...x, adjustLaborPct: n } : x)),
                                  )
                                }
                              />
                            </Field>
                            <div className="flex items-end gap-2 pb-1">
                              <Switch
                                id={`ss-${p.id}`}
                                checked={p.useSlipsheet ?? false}
                                onCheckedChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => (j === i ? { ...x, useSlipsheet: v } : x)),
                                  )
                                }
                              />
                              <Label htmlFor={`ss-${p.id}`} className="text-xs">
                                Use Slipsheet
                              </Label>
                            </div>
                          </div>
                        </div>
                        {/* Legacy wall extras (docs §8.4/§8.6): wood blocking (labor-only
                            TopOfParapet item), capstone masonry, and parapet ARP — all
                            auto-priced from the seeded rates. */}
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Wall extras (auto-priced)
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                            <div className="flex items-end gap-2 pb-1">
                              <Switch
                                id={`bk-${p.id}`}
                                checked={p.hasBlocking ?? false}
                                onCheckedChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => (j === i ? { ...x, hasBlocking: v } : x)),
                                  )
                                }
                              />
                              <Label htmlFor={`bk-${p.id}`} className="text-xs">
                                Wood blocking
                              </Label>
                            </div>
                            <Field label="Capstones">
                              <PickOne
                                value={
                                  p.capstoneOption === 1
                                    ? "Remove only"
                                    : p.capstoneOption === 2
                                      ? "Remove & reinstall"
                                      : "None"
                                }
                                options={["None", "Remove only", "Remove & reinstall"]}
                                onChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => {
                                      if (j !== i) return x;
                                      const nx = { ...x };
                                      if (v === "None") {
                                        delete nx.capstoneOption;
                                        delete nx.capstoneLengthFt;
                                      } else nx.capstoneOption = v === "Remove only" ? 1 : 2;
                                      return nx;
                                    }),
                                  )
                                }
                              />
                            </Field>
                            {(p.capstoneOption ?? 0) > 0 && (
                              <Field label="Capstone len (ft)">
                                <NumInput
                                  min={0}
                                  value={p.capstoneLengthFt ?? p.lengthFt}
                                  onValue={(n) =>
                                    setParapets((prev) =>
                                      prev.map((x, j) =>
                                        j === i ? { ...x, capstoneLengthFt: n } : x,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                            )}
                            <Field label="ARP size">
                              <PickOne
                                value={(p.arpSizeIn ?? 0) > 0 ? `${p.arpSizeIn}"` : "None"}
                                options={["None", '12"', '18"', '24"', '30"']}
                                onChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => {
                                      if (j !== i) return x;
                                      const nx = { ...x };
                                      if (v === "None") {
                                        delete nx.arpSizeIn;
                                        delete nx.arpLengthFt;
                                      } else nx.arpSizeIn = parseInt(v, 10);
                                      return nx;
                                    }),
                                  )
                                }
                              />
                            </Field>
                            {(p.arpSizeIn ?? 0) > 0 && (
                              <Field label="ARP len (ft)">
                                <NumInput
                                  min={0}
                                  value={p.arpLengthFt ?? p.lengthFt}
                                  onValue={(n) =>
                                    setParapets((prev) =>
                                      prev.map((x, j) => (j === i ? { ...x, arpLengthFt: n } : x)),
                                    )
                                  }
                                />
                              </Field>
                            )}
                          </div>
                        </div>
                        {/* Legacy Termination sub-tab (docs §12.6): feeds the Accessories edge
                            screens' "Parapets:" footage — no direct money of its own. */}
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Termination</p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Field label="Termination">
                              <PickOne
                                value={
                                  TERMINATION_OPTIONS.find(
                                    (t) => TERMINATION_ID_BY_LABEL[t] === p.termOptionId,
                                  ) ?? "No Termination"
                                }
                                options={[...TERMINATION_OPTIONS]}
                                onChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) => {
                                      if (j !== i) return x;
                                      const nx = { ...x };
                                      const id = TERMINATION_ID_BY_LABEL[v];
                                      if (id === undefined) {
                                        delete nx.termOptionId;
                                        delete nx.termLengthFt;
                                      } else nx.termOptionId = id;
                                      return nx;
                                    }),
                                  )
                                }
                              />
                            </Field>
                            {(p.termOptionId ?? 0) > 0 && (
                              <Field label="Term length (ft)">
                                <NumInput
                                  min={0}
                                  value={p.termLengthFt ?? p.lengthFt}
                                  onValue={(n) =>
                                    setParapets((prev) =>
                                      prev.map((x, j) => (j === i ? { ...x, termLengthFt: n } : x)),
                                    )
                                  }
                                />
                              </Field>
                            )}
                            <Field label="Wall type">
                              <PickOne
                                value={
                                  (p.wallType ?? 1) === 1 ? "Wood or Metal" : "Brick or Concrete"
                                }
                                options={["Wood or Metal", "Brick or Concrete"]}
                                onChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) =>
                                      j === i
                                        ? { ...x, wallType: v === "Wood or Metal" ? 1 : 4 }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <div className="flex items-end gap-2 pb-1">
                              <Switch
                                id={`tbb-${p.id}`}
                                checked={p.useTermBarOnBase ?? false}
                                onCheckedChange={(v) =>
                                  setParapets((prev) =>
                                    prev.map((x, j) =>
                                      j === i ? { ...x, useTermBarOnBase: v } : x,
                                    ),
                                  )
                                }
                              />
                              <Label htmlFor={`tbb-${p.id}`} className="text-xs">
                                Use Term Bar on Base
                              </Label>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Right rail: legacy wall-profile diagram + parapet summary */}
                  <div className="space-y-2">
                    <ParapetProfileDiagram
                      p={parapets[Math.min(selParapet, parapets.length - 1)]!}
                    />
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
                    {/* Legacy bottom readouts: Vertical Wall / Total Wall / Parapet Membrane */}
                    {(() => {
                      const girthOf = (p2: ParapetInput) =>
                        (p2.skirtInches ?? 0) +
                          (p2.cantInches ?? 0) +
                          (p2.verticalInches ?? 0) +
                          (p2.wallTopInches ?? 0) +
                          (p2.dropInches ?? 0) || p2.girthInches;
                      const vertSqFt = parapets.reduce(
                        (s2, p2) => s2 + (p2.lengthFt * (p2.verticalInches ?? 0)) / 12,
                        0,
                      );
                      const totalSqFt = parapets.reduce(
                        (s2, p2) => s2 + (p2.lengthFt * girthOf(p2)) / 12,
                        0,
                      );
                      const membraneSqFt = parapets.reduce((s2, p2) => {
                        const pieces = p2.pieces ?? 1;
                        const adjLen = pieces >= 1 ? p2.lengthFt + 1 + pieces : 0;
                        return s2 + (Math.ceil(girthOf(p2)) / 12) * adjLen;
                      }, 0);
                      return (
                        <div className="flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2 text-[11px]">
                          <span>
                            Vertical Wall Sq Ft:{" "}
                            <span className="font-semibold tabular-nums">
                              {vertSqFt.toFixed(2)}
                            </span>
                          </span>
                          <span>
                            Total Wall Sq Ft:{" "}
                            <span className="font-semibold tabular-nums">
                              {totalSqFt.toFixed(2)}
                            </span>
                          </span>
                          <span>
                            Parapet Membrane Sq Ft:{" "}
                            <span className="font-semibold tabular-nums">
                              {membraneSqFt.toFixed(2)}
                            </span>
                          </span>
                        </div>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground">
                      Click a row to edit that parapet.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Legacy Curbs screen (frmCurbs): style toolstrip, dims, termination, insulation /
            plastic, the picCurb drawing with the A/B/C/D readout and the lvSummary — docs
            §8.1–§8.3. Wrap material via curb-wrap.ts (§2); labor per §8.2 BaseHours. */}
        <div className={step === 4 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Curbs</CardTitle>
            </CardHeader>
            <CardContent>
              <CurbsScreen
                curbs={curbs}
                onChange={setCurbs}
                selected={selCurb}
                onSelect={setSelCurb}
                sections={sections.map((s) => ({
                  id: s.id,
                  name: s.name,
                  deckType: s.deckType,
                  thickness: s.thickness,
                  color: s.color,
                }))}
                deckOptions={admin.deckOrder}
                colorOptions={colorOptions}
                crewRate={laborRate}
                hoursById={result?.curbHoursById ?? {}}
                totalHours={result?.r.curbLaborHours ?? 0}
                newCurb={() => newCurb()}
              />
            </CardContent>
          </Card>
        </div>

        <div className={step === 5 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Accessories</CardTitle>
              {result?.accessories && (
                <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                  <span>
                    Material Cost:{" "}
                    <span className="font-semibold">
                      {money(result.accessories.totalCost + accessoryTotal)}
                    </span>
                  </span>
                  <span>
                    Total Labor:{" "}
                    <span className="font-semibold">
                      {(result.accessories.manHours + accessoryLaborHours).toFixed(2)} h
                    </span>
                  </span>
                  <span>
                    Labor Cost:{" "}
                    <span className="font-semibold">
                      {money((result.accessories.manHours + accessoryLaborHours) * laborRate)}
                    </span>
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <AccessoriesScreens
                state={accessoriesCalc}
                onChange={setAccessoriesCalc}
                refData={admin?.accessories}
                result={result?.accessories}
                sections={sections.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
                adhesiveNames={Object.keys(admin?.adhesivePrices ?? {})}
                adhesiveCalc={result?.adhesiveWholeUnits}
                arpCalcQty={result?.accessories?.membraneAccs.arpCalc ?? 0}
              />
            </CardContent>
          </Card>
          {/* Old flat-picker lines: only rendered when a bid already carries them (pre-§12
              saved bids) — the calculated screens above are the legacy money path. */}
          {accessories.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">Extra catalog lines (older bid)</CardTitle>
                <CardDescription className="text-xs">
                  Manual price-list additions (kept for older bids); the calculated screens above
                  are the legacy money path.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CatalogPicker
                  items={(accCatalog ?? []).map((a) => ({
                    key: a.key,
                    category: a.category,
                    description: a.description,
                    price: a.price,
                  }))}
                  onAdd={(key) => {
                    const item = accCatalog?.find((a) => a.key === key);
                    if (!item) return;
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
                  }}
                />

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
          )}

          {/* The pre-§12 "Calculated needs" summary panel was removed: each accessory screen
              now carries its own legacy needed counters (red Fasteners Needed / Items Required),
              netted against the quantities typed on that screen. */}
        </div>

        {/* Legacy EXCEPTIONAL Metals screen (frmMetals): four entry tiles + the lvSummary grid.
            Money per docs §13 (extracted IL): material → dMaterial[5] inside M0, labor at each
            row's own rate → dLabor[5] direct labor. */}
        <div className={step === 6 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">EXCEPTIONAL Metals</CardTitle>
              {result?.metalsScreen && result.metalsScreen.lines.length > 0 && (
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>
                    Material:{" "}
                    <span className="font-semibold">{money(result.metalsScreen.materialCost)}</span>
                  </span>
                  <span>
                    Hours:{" "}
                    <span className="font-semibold">
                      {result.metalsScreen.laborHours.toFixed(2)} h
                    </span>
                  </span>
                  <span>
                    Labor Cost:{" "}
                    <span className="font-semibold">{money(result.metalsScreen.laborCost)}</span>
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <MetalsScreens
                refData={admin?.metals}
                state={metalsCalc}
                onChange={setMetalsCalc}
                result={result?.metalsScreen}
              />
            </CardContent>
          </Card>
          {/* Old flat-picker lines: only rendered when a bid already carries them (pre-§13
              saved bids) — the tile screens above are the legacy money path. */}
          {metals.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">Extra catalog lines (older bid)</CardTitle>
              </CardHeader>
              <CardContent>
                <CatalogPicker
                  items={(metalsCatalog ?? []).map((m) => ({
                    key: m.key,
                    category: m.category,
                    description: m.description,
                    price: m.unitCost,
                  }))}
                  onAdd={(key) => {
                    const item = metalsCatalog?.find((m) => m.key === key);
                    if (!item) return;
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
                />
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
              </CardContent>
            </Card>
          )}
        </div>

        {/* Legacy Tear-Off screen (mirrors the 2026-08-31 12:44 capture): section select grid,
            type tiles grouped Single Ply / Built Up / Urethane, thickness + disposal capacity,
            the red labor-variables note, and the Existing Roof / Deck info panel. */}
        <div className={step === 7 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Tear-Off</CardTitle>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Select Roof Section(s) or:</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setToSel(sections.map((s) => s.id))}
                >
                  Select All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Section</TableHead>
                          <TableHead>Deck</TableHead>
                          <TableHead>W x L</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sections.map((s) => {
                          const sel = toSel.includes(s.id);
                          return (
                            <TableRow
                              key={s.id}
                              onClick={() =>
                                setToSel((prev) =>
                                  prev.includes(s.id)
                                    ? prev.filter((x) => x !== s.id)
                                    : [...prev, s.id],
                                )
                              }
                              className={sel ? "cursor-pointer bg-primary/15" : "cursor-pointer"}
                            >
                              <TableCell className="font-medium">{s.name}</TableCell>
                              <TableCell>{s.deckType}</TableCell>
                              <TableCell className="tabular-nums">
                                {s.width}x{s.length}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Type tiles, grouped like the legacy trio (the urethane tile is a dropdown
                      group in legacy). */}
                  <div className="space-y-3 rounded-md border p-3">
                    {(() => {
                      const types = admin.tearOff?.tearoffTypes ?? [];
                      const groups: Array<[string, string[]]> = [
                        ["Single Ply & Combinations", []],
                        ["Built Up, Modified & Combinations", []],
                        ["Urethane", []],
                      ];
                      for (const t of types) {
                        if (/uret|spray/i.test(t)) groups[2]![1].push(t);
                        else if (/bur|built|mod/i.test(t)) groups[1]![1].push(t);
                        else groups[0]![1].push(t);
                      }
                      return (
                        <div className="grid gap-3 sm:grid-cols-3">
                          {groups
                            .filter(([, ts]) => ts.length > 0)
                            .map(([label, ts]) => (
                              <div key={label} className="rounded-md border p-2">
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {label}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {ts.map((t) => (
                                    <button
                                      key={t}
                                      type="button"
                                      onClick={() => setToType(t)}
                                      className={`rounded-md border px-2 py-1.5 text-xs ${
                                        toType === t
                                          ? "border-primary bg-primary/10 font-medium"
                                          : "hover:bg-muted"
                                      }`}
                                    >
                                      {t}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Thickness (in)">
                        <NumInput
                          className="w-[100px]"
                          min={0}
                          value={toDepth}
                          onValue={(n) => setToDepth(n)}
                        />
                      </Field>
                      <Field label="Disposal Unit Capacity Adjustments">
                        <PickOne
                          value="Normal Fill"
                          options={["Normal Fill"]}
                          onChange={() => {}}
                        />
                      </Field>
                      <Button
                        size="sm"
                        disabled={!toType || toSel.length === 0}
                        onClick={() =>
                          setSections((prev) =>
                            prev.map((s) =>
                              toSel.includes(s.id)
                                ? {
                                    ...s,
                                    tearOff: true,
                                    tearOffType: toType,
                                    toThicknessInches: toDepth,
                                  }
                                : s,
                            ),
                          )
                        }
                      >
                        Apply to selected
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={toSel.length === 0}
                        onClick={() =>
                          setSections((prev) =>
                            prev.map((s) =>
                              toSel.includes(s.id)
                                ? { ...s, tearOff: false, tearOffType: "", toThicknessInches: 0 }
                                : s,
                            ),
                          )
                        }
                      >
                        ✕ Don&apos;t Tear-off
                      </Button>
                    </div>
                  </div>

                  {/* Legacy red note, verbatim. */}
                  <div className="rounded-md border p-3 text-xs">
                    <p className="mb-1 font-semibold">Labor Cost Variables To Consider</p>
                    <div className="space-y-0.5 text-red-600 dark:text-red-400">
                      <p>
                        a) Rock Removal — 1. Manual · 2. Vacuum service - Enter Quote in Non-DL
                        services
                      </p>
                      <p>
                        b) Roofing Composition — 1. Asbestos · 2. Coal Tar Pitch · 3. Hot Mopped
                        Base Sheet · 4. Severely Decomposed Roofing · 5. Heavily Nailed Roofing
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right rail: legacy info panel (Existing Roof / Deck bars + core-cut table). */}
                <div className="space-y-2">
                  {(() => {
                    const focus = sections.find((s) => toSel.includes(s.id)) ?? sections[0];
                    return (
                      <div className="space-y-1.5 rounded-md border p-3">
                        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
                          <span className="text-muted-foreground">Existing Roof:</span>
                          <span className="rounded-sm bg-muted px-2 py-1 text-center font-medium">
                            {focus?.tearOff ? focus.tearOffType || "(no type)" : "Unknown"}
                          </span>
                          <span className="text-muted-foreground">Deck:</span>
                          <span className="rounded-sm bg-blue-500/80 px-2 py-1 text-center font-medium text-white">
                            {focus?.deckType ?? "—"}
                          </span>
                        </div>
                        <p className="pt-1 text-xs">
                          <span className="font-semibold">Roof Section:</span> {focus?.name ?? "—"}
                          <span className="float-right">
                            <span className="font-semibold">Total Thickness:</span>{" "}
                            <span className="tabular-nums">
                              {(focus?.tearOff ? focus.toThicknessInches : 0).toFixed(1)}
                            </span>
                          </span>
                        </p>
                      </div>
                    );
                  })()}
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>W x L</TableHead>
                          <TableHead>Core Cut</TableHead>
                          <TableHead className="text-right">Thickness</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sections.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="tabular-nums">
                              {s.width}x{s.length}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {s.tearOff ? s.tearOffType || "(no type)" : "Unknown"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(s.tearOff ? s.toThicknessInches : 0).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2 text-[11px]">
                    <span>
                      Man Hours:{" "}
                      <span className="font-semibold tabular-nums">
                        {(result?.r.tearOffLaborHours ?? 0).toFixed(2)}
                      </span>
                    </span>
                    <span>
                      Labor Cost:{" "}
                      <span className="font-semibold tabular-nums">
                        {money((result?.r.tearOffLaborHours ?? 0) * laborRate)}
                      </span>
                    </span>
                    <span>
                      Disposal Units:{" "}
                      <span className="font-semibold tabular-nums">
                        {result?.r.disposalUnits ?? 0}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Legacy Non-Duro-Last Items screen (frmNonDL): six entry tiles + the lvSummary grid.
            Money per docs §14 (extracted IL): six material groups → OtherMaterial (taxable) with
            direct labor at each row's own rate; subs & services → LaborSubtotal2. */}
        <div className={step === 8 ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Non-Duro-Last Items</CardTitle>
              {result?.nonDl && result.nonDl.lines.length > 0 && (
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>
                    Other material:{" "}
                    <span className="font-semibold">{money(result.nonDl.otherMaterial)}</span>
                  </span>
                  <span>
                    Hours:{" "}
                    <span className="font-semibold">{result.nonDl.totalHours.toFixed(2)} h</span>
                  </span>
                  <span>
                    Labor Cost:{" "}
                    <span className="font-semibold">{money(result.nonDl.totalLaborCost)}</span>
                  </span>
                  {result.nonDl.subsCost + result.nonDl.servicesCost > 0 && (
                    <span>
                      Subs &amp; services:{" "}
                      <span className="font-semibold">
                        {money(result.nonDl.subsCost + result.nonDl.servicesCost)}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <NonDlScreens
                refData={admin?.nonDl}
                state={nonDlCalc}
                onChange={setNonDlCalc}
                result={result?.nonDl}
                crewRate={laborRate}
              />
            </CardContent>
          </Card>
          {/* Old flat-picker lines: only rendered when a bid already carries them (pre-§14
              saved bids) — the tile screens above are the legacy money path. */}
          {nonDlLines.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">Extra catalog lines (older bid)</CardTitle>
              </CardHeader>
              <CardContent>
                <CatalogPicker
                  items={(nonDlCatalog ?? []).map((n2) => ({
                    key: n2.key,
                    category: n2.category,
                    description: n2.description,
                    price: n2.price,
                  }))}
                  onAdd={(key) => {
                    const item = nonDlCatalog?.find((n2) => n2.key === key);
                    if (!item) return;
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
                />
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
              </CardContent>
            </Card>
          )}
        </div>

        <div className={step === 9 && showPricingSettings ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Pricing controls</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowPricingSettings(false)}>
                Hide settings
              </Button>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {(presets?.length ?? 0) > 0 && (
                <Field label="Preset">
                  <Select value={presetName} onValueChange={applyPreset}>
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
                  onChange={(e) => setAdjustLaborPct(numAdj(e.target.value))}
                />
              </Field>
              <Field label="Adjust setup %">
                <Input
                  type="number"
                  value={adjustSetupPct}
                  onChange={(e) => setAdjustSetupPct(numAdj(e.target.value))}
                />
              </Field>
              <Field label="Adjust inspection %">
                <Input
                  type="number"
                  value={adjustInspectionPct}
                  onChange={(e) => setAdjustInspectionPct(numAdj(e.target.value))}
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
              {effHighWind?.isHighWind ? (
                <Field label={`Max Expected Wind (${effHighWind.termYears} yr high-wind warranty)`}>
                  <PickOne
                    value={MAX_WIND_OPTIONS.find((o) => o.band === effHighWind.band)?.label ?? "—"}
                    options={["—", ...MAX_WIND_OPTIONS.map((o) => o.label)]}
                    onChange={(v) =>
                      setMaxWindExpected(MAX_WIND_OPTIONS.find((o) => o.label === v)?.value)
                    }
                  />
                </Field>
              ) : (
                <p className="pb-2 text-xs text-muted-foreground">
                  Not a high-wind warranty (the warranty itself carries the high-wind flag and
                  term).
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className={step === 9 ? "space-y-6" : "hidden"}>
          {result && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Estimate Review</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPricingSettings((v) => !v)}
                >
                  {showPricingSettings ? "Hide settings" : "Settings (warranty, labor rate…)"}
                </Button>
              </CardHeader>
              <CardContent>
                {customer.notes.trim() !== "" && (
                  <p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
                    <span className="font-medium">Notes (from Setup):</span> {customer.notes}
                  </p>
                )}
                <EstimateReviewLedger
                  ledger={result.ledger}
                  est={result.r}
                  stats={{
                    roofSqFt: result.r.roofSqFootage,
                    membraneSqFt: result.r.sqFtTotalMembrane,
                    parapetVertSqFt: parapetWallStats.vert,
                    parapetWallSqFt: parapetWallStats.total,
                  }}
                  discounts={{
                    prepay: prepayDiscount,
                    std: stdSizeDiscount,
                    volume: volumeDiscount,
                    onPrepay: setPrepayDiscount,
                    onStd: setStdSizeDiscount,
                    onVolume: setVolumeDiscount,
                  }}
                  markup={{
                    mode: markupMode,
                    value: markup,
                    onChange: (m, val) => {
                      setMarkupMode(m);
                      setMarkup(val);
                    },
                  }}
                  perDiem={{ rate: perDiem, onChange: setPerDiem }}
                  commission={{ pct: commission, onChange: setCommission }}
                  extraShipping={{ value: extraShipping, onChange: setExtraShipping }}
                  onOpenSettings={() => setShowPricingSettings(true)}
                />
              </CardContent>
            </Card>
          )}
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
                  For ordering only — ARP material and parapet blocking/capstones now auto-price
                  (§8); termination hardware footage is still priced by adding Accessory / Non-DL
                  lines until its per-ft vs per-piece basis is extracted.
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
                        result.curbMaterial -
                        result.metalsMaterial -
                        result.adhesiveMaterial,
                    )}
                  />
                  {result.parapetMaterial > 0 && (
                    <Row label="Parapet material" v={money(result.parapetMaterial)} />
                  )}
                  {result.curbMaterial > 0 && (
                    <Row label="Curb material" v={money(result.curbMaterial)} />
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
                  {(result.r.money.dTotals[7] ?? 0) > 0 && (
                    <Row
                      label="Other material (non-DL)"
                      v={money(result.r.money.dTotals[7] ?? 0)}
                    />
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
                  <Row label="Sales tax" v={money(result.r.money.taxCharged)} />
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

/**
 * Legacy Parapets screen wall-profile diagram: the membrane path over the wall drawn live from
 * the five profile dims (skirt along the roof, cant diagonal, vertical up, top-of-wall across,
 * drop down the far side), with red inch labels like the legacy app.
 */
function ParapetProfileDiagram({ p }: { p: ParapetInput }) {
  const skirt = p.skirtInches ?? 0;
  const cant = p.cantInches ?? 0;
  const vert = p.verticalInches ?? 0;
  const top = p.wallTopInches ?? 0;
  const drop = p.dropInches ?? 0;
  const girth = skirt + cant + vert + top + drop || p.girthInches;
  const c707 = 0.7071;
  // Membrane path in inch-space, y up.
  const pts: Array<[number, number]> = [[0, 0]];
  const push = (dx: number, dy: number) => {
    const [x, y] = pts[pts.length - 1]!;
    pts.push([x + dx, y + dy]);
  };
  push(skirt, 0); // skirt along the roof
  push(cant * c707, cant * c707); // cant up at 45°
  push(0, vert); // vertical wall
  push(top, 0); // top of wall
  push(0, -drop); // drop down the outside
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const w = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const scale = Math.min(150 / w, 120 / h);
  const X = (x: number) => 40 + (x - Math.min(...xs)) * scale;
  const Y = (y: number) => 150 - (y - Math.min(...ys)) * scale;
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${X(x)},${Y(y)}`).join(" ");
  const mid = (i: number): [number, number] => {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    return [(X(a[0]) + X(b[0])) / 2, (Y(a[1]) + Y(b[1])) / 2];
  };
  const labels: Array<{ v: number; at: [number, number]; dx: number; dy: number }> = [
    { v: skirt, at: mid(0), dx: 0, dy: 14 },
    { v: cant, at: mid(1), dx: 14, dy: 6 },
    { v: vert, at: mid(2), dx: -8, dy: 0 },
    { v: top, at: mid(3), dx: 0, dy: -8 },
    { v: drop, at: mid(4), dx: 14, dy: 0 },
  ];
  return (
    <div className="rounded-md border p-3">
      <p className="mb-1 text-xs font-semibold">{p.name} — wall profile</p>
      {girth <= 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Enter the wall dims to draw the profile.
        </p>
      ) : (
        <svg viewBox="0 0 230 170" className="h-40 w-full text-foreground">
          {/* roof deck baseline */}
          <line
            x1="8"
            y1={Y(0)}
            x2={X(0) + 4}
            y2={Y(0)}
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.35"
          />
          <path d={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          {labels
            .filter((l) => l.v > 0)
            .map((l, i) => (
              <text
                key={i}
                x={l.at[0] + l.dx}
                y={l.at[1] + l.dy}
                textAnchor="middle"
                className="fill-red-600 text-[10px] font-semibold dark:fill-red-400"
              >
                {l.v}"
              </text>
            ))}
          <text
            x="222"
            y="164"
            textAnchor="end"
            className="fill-red-600 text-[10px] font-semibold dark:fill-red-400"
          >
            Girth: {girth}"
          </text>
        </svg>
      )}
      <p className="text-[11px] text-muted-foreground">
        Skirt → cant → vertical → top of wall → drop
      </p>
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

/**
 * Legacy-style catalog picker (mirrors the legacy Accessories screen): category tree on the
 * left, searchable item list on the right, one click to add a line.
 */
function CatalogPicker({
  items,
  onAdd,
}: {
  items: Array<{ key: string; category: string; description: string; price: number }>;
  onAdd: (key: string) => void;
}) {
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const query = q.trim().toLowerCase();
  const searching = query.length > 0;
  const shown = searching
    ? items.filter((i) => `${i.category} ${i.description}`.toLowerCase().includes(query))
    : cat !== null
      ? items.filter((i) => i.category === cat)
      : [];
  return (
    <div className="mb-4 grid gap-3 rounded-md border p-3 md:grid-cols-[230px_minmax(0,1fr)]">
      <div className="space-y-2">
        <Input
          className="h-8"
          placeholder="Search all items…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCat(cat === c ? null : c);
                setQ("");
              }}
              className={`flex w-full items-center justify-between gap-2 border-b px-2.5 py-1.5 text-left text-xs last:border-b-0 ${
                cat === c && !searching
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-muted"
              }`}
            >
              <span>{c}</span>
              <span className="text-muted-foreground tabular-nums">
                {items.filter((i) => i.category === c).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-md border">
        {shown.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {searching ? "No items match." : "Pick a category on the left, or search."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {shown.map((i) => (
                <tr key={i.key} className="border-b last:border-b-0 hover:bg-muted/50">
                  <td className="px-2.5 py-1.5">
                    {searching && (
                      <span className="block text-[11px] text-muted-foreground">{i.category}</span>
                    )}
                    {i.description}
                  </td>
                  <td className="w-24 px-2.5 py-1.5 text-right tabular-nums">{money(i.price)}</td>
                  <td className="w-16 px-2 py-1 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => onAdd(i.key)}
                    >
                      Add
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Number input that keeps its raw text while focused — a default 0 can be backspaced or is
 * replaced by select-on-focus (legacy field behavior) — and commits the parsed number.
 */
function NumInput({
  value,
  onValue,
  min,
  className,
}: {
  value: number;
  onValue: (n: number) => void;
  min?: number;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      type="number"
      min={min}
      className={className}
      value={text ?? String(value)}
      onFocus={(e) => {
        setText(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        onValue(Math.max(min ?? 0, num(e.target.value)));
      }}
      onBlur={() => setText(null)}
    />
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
  disabled,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled ?? false}>
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
