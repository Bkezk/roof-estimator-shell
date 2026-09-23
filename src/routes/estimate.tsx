import { Link, createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  AlertTriangle,
  Save,
  Copy,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Lock,
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
  effectiveLayerAttachment,
  fluteFillerPieces,
  TAB_OPTIONS_BY_SYSTEM,
  MAX_UNDERLAYMENT_LAYERS,
  type UnderlaymentLayer,
} from "@/lib/engine/bid-builder";
import { computeEstimate, computeSectionInstallHours } from "@/lib/engine/estimate";
import { combineSavedBids, combineWarningLines, type CombineInfo } from "@/lib/combine-bids";
import { emptyPerDiemChart, normalizePerDiemChart } from "@/lib/per-diem-chart";
import { PerDiemChartEditor, PerDiemChartView } from "@/components/per-diem-chart";
import { LaborAdjustDialog } from "@/components/labor-adjust-dialog";
import { tearOffLaborForSection } from "@/lib/engine/quantities";
import { buildOrderList, describeOrderQty, type OrderLine } from "@/lib/order-list";
import { ORDER_COLUMNS, orderListHtml, orderListRows, toBuyCount } from "@/lib/order-list-export";
import * as XLSX from "xlsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { addMovement, listMovements, listStock } from "@/lib/inventory.functions";
import { listPriceTargets } from "@/lib/admin-item-numbers.functions";
import {
  adhesiveOptionsForSystem,
  deriveAdhesiveSubstrate,
  normalizeAdminSnapshot,
} from "@/lib/engine/adapters";
import { buildReviewLedger } from "@/lib/engine/review-ledger";
import { EstimateReviewLedger } from "@/components/estimate-review-ledger";
import type { MarkupMode } from "@/lib/engine/money";
import { defaultEdges, resolveSectionZones, TERMINATION_OPTIONS } from "@/lib/engine/edges";
import { underlaymentLayerFasteners } from "@/lib/engine/underlayment-fasteners";
import { SectionsScreen } from "@/components/sections-screen";
import { AccessoriesScreens } from "@/components/accessories-screens";
import { AccessorySummaryCard } from "@/components/accessory-summary-card";
import { MetalsScreens } from "@/components/metals-screens";
import { CurbsScreen } from "@/components/curbs-screen";
import { ParapetsScreen } from "@/components/parapets-screen";
import {
  applyLaborTemplate,
  laborTemplateDeltas,
  seedCurbAdjust,
  seedParapetAdjust,
  seedSectionAdjust,
} from "@/lib/engine/labor-template";
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
import { attachedWithLabel, attachedWithOptions } from "@/lib/engine/adapters";
import { BID_STATUSES, STATUS_LABELS, asBidStatus, type BidStatus } from "@/lib/bid-status";
import { useAuth } from "@/lib/auth-store";
import { useBidLock } from "@/lib/use-bid-lock";
import { LayerStack, TileGlyph } from "@/components/layer-stack";
import { UpdateBidDialog, type UpdateBidOptions } from "@/components/update-bid-dialog";
import { CURRENT_FORMULAS_VERSION } from "@/lib/engine/version";
import { countNonDlOverrides, pinNonDlToRef } from "@/lib/engine/nondl";
import { listEstimatorNames } from "@/lib/auth.functions";
import { buildReviewRows, toCsv } from "@/lib/review-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
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
import { AutoTextarea } from "@/components/ui/auto-textarea";
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
  validateSearch: (s: Record<string, unknown>): { bid?: string; combine?: string } => {
    const b = s["bid"];
    const c = s["combine"];
    return {
      ...(typeof b === "string" ? { bid: b } : {}),
      // Bid Combiner (docs §22.41): comma-separated ids of the bids to merge into a NEW bid.
      ...(typeof c === "string" && c ? { combine: c } : {}),
    };
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
/** Underlayment layer slots 0..4 (legacy's four "Add Layer" tabs plus the web's fifth, §22.40). */
const LAYER_SLOTS = Array.from({ length: MAX_UNDERLAYMENT_LAYERS }, (_, i) => i);
/** The stack visual draws the top layer first. */
const LAYER_SLOTS_TOP_DOWN = [...LAYER_SLOTS].reverse();
/** A picker's option list with the stored value kept visible even when it is no longer offered. */
/** JSON with object keys sorted at every level — equal data serialises equally whatever the key order. */
const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val as Record<string, unknown>)
            .sort()
            .map((k) => [k, (val as Record<string, unknown>)[k]]),
        )
      : val,
  );
const withCurrent = (options: string[], current: string): string[] =>
  current && !options.includes(current) ? [current, ...options] : options;
type UAttach = "mechanical" | "adhesive" | "none" | "durobond";
/** Underlayment "Attached With" labels (legacy frmUnderlayment.cbAttachedWith wording). */
const U_ATTACH_LABEL: Record<UAttach, string> = {
  mechanical: "Mechanically Fastened",
  adhesive: "Adhesive",
  none: "None",
  durobond: "Section Fastened w/ Durobond",
};
/**
 * Legacy frmUnderlayment.LoadAttachment (0xadd24, docs §10.4 / §22.28): a Duro-Bond section gets
 * ONLY "Section Fastened w/ Durobond" ("1+ Sections Use DuroBond" when several sections are
 * selected), pre-selected and disabled; every other system lists None / Mechanically Fastened /
 * the eligible adhesives.
 */
const uAttachOptions = (isDuroBond: boolean, multi = false): string[] =>
  isDuroBond
    ? [multi ? "1+ Sections Use DuroBond" : U_ATTACH_LABEL.durobond]
    : [U_ATTACH_LABEL.mechanical, U_ATTACH_LABEL.adhesive, U_ATTACH_LABEL.none];
const uAttachFromLabel = (label: string): UAttach =>
  (Object.keys(U_ATTACH_LABEL) as UAttach[]).find((k) => U_ATTACH_LABEL[k] === label) ??
  "mechanical";

let seq = 1;
const newSection = (defaults: Partial<BidSectionInput> = {}): BidSectionInput => ({
  id: `s${seq++}`,
  name: `Section ${seq - 1}`,
  // Blank dimensions: the estimator must key both (a 100×100 prefill was silently priced when
  // a section was forgotten).
  length: 0,
  width: 0,
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
  // Legacy Edge Options: four sides (A/C = Length, B/D = Width), no corners, Quick Bid.
  // Complexity "Medium" (index 3; legacy started at "Moderate" 2 — owner's departure, docs
  // §22.38; only priced on systems with complexity factors).
  edges: defaultEdges(0, 0),
  perimCorners: [false, false, false, false],
  isQuickBid: true,
  complexity: 3,
  ...defaults,
});

let pseq = 1;
const newParapet = (defaults: Partial<ParapetInput> = {}): ParapetInput => ({
  id: `p${pseq++}`,
  name: `Parapet ${pseq - 1}`,
  // Legacy frmParapets.ResetFields defaults: Length 1, Pieces 1, Skirt 6", every other dim 0.
  // Height band is derived from Vertical (LookupParapetTimes) so it starts empty.
  lengthFt: 1,
  heightBand: "",
  deckType: "Wood",
  predrill: false,
  canted: false,
  // Legacy wall profile dims (in); girth = their sum.
  skirtInches: 6,
  cantInches: 0,
  verticalInches: 0,
  wallTopInches: 0,
  dropInches: 0,
  girthInches: 6,
  // Legacy Setup default "2. Wall Type" = 4 (Brick or Concrete, pre-drill) — docs §22.9.
  wallType: 4,
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
  const listEstimatorsFn = useServerFn(listEstimatorNames);
  const saveBidFn = useServerFn(saveBid);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { bid: bidParam, combine: combineParam } = Route.useSearch();
  // Gate every authed fetch on a live session: without one the server fns 401 (e.g. a mobile
  // browser whose token expired while backgrounded); AuthGate redirects to /login.
  const { session, profile } = useAuth();
  const authed = !!session;

  // Estimator roster (admin General → Estimators) for the Setup "Estimator's Name" dropdown.
  const { data: estimatorNames } = useQuery({
    queryKey: ["estimator-names"],
    queryFn: () => listEstimatorsFn(),
    enabled: authed,
  });

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

  // What the "Update Pricing & Labor" button compares the frozen snapshot against: the admin
  // data as last fetched (refreshed by the button itself so it disappears once applied).
  const [liveCheck, setLiveCheck] = useState<{
    admin: EngineAdminData;
    warranty: WarrantyData | null;
  } | null>(null);

  // Legacy Home shows "Update Pricing & Labor" as a standing button; here it appears only while
  // the bid's frozen snapshot differs from the current admin pricing / labor / warranty data,
  // and goes away once applied (owner's request, §22.25).
  const pricingStale = useMemo(() => {
    if (!snapshot) return false;
    const liveA = liveCheck?.admin ?? liveAdmin;
    if (!liveA) return false;
    const liveW = liveCheck ? liveCheck.warranty : (liveWarrantyData ?? null);
    // Both sides through the same normaliser so an older snapshot's missing defaults don't
    // read as a pricing change, and a key-ORDER-insensitive serialisation: the saved snapshot
    // comes back from Postgres jsonb with its object keys re-sorted, so a plain
    // JSON.stringify compare flagged every reloaded bid as stale.
    return (
      stableJson(normalizeAdminSnapshot(snapshot.admin)) !==
        stableJson(normalizeAdminSnapshot(liveA)) ||
      stableJson(snapshot.warranty ?? null) !== stableJson(liveW ?? null)
    );
  }, [snapshot, liveCheck, liveAdmin, liveWarrantyData]);

  const [roofSystem, setRoofSystem] = useState("Duro-Last");
  const [attachment, setAttachment] = useState<"mechanical" | "adhered">("mechanical");
  const [membraneAdhesive, setMembraneAdhesive] = useState("Water Based Adhesive");
  // A bid starts with NO roof sections (the total starts at $0 — legacy "Existing Bids" opens
  // on Home with an empty section list); sections are added on the Sections step.
  const [sections, setSections] = useState<BidSectionInput[]>([]);
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
  // Legacy frmLaborTemplate txtHrsPerDay: hours per man-day is per estimate (admin default).
  const [hoursPerDay, setHoursPerDay] = useState<number | undefined>(undefined);
  const [extraShipping, setExtraShipping] = useState(0);
  // The legacy Review screen shows the ledger; the auxiliary knobs (warranty picker, labor
  // rate, templates…) sit behind this toggle instead of always-on forms.
  const [showPricingSettings, setShowPricingSettings] = useState(false);
  // A saved bid whose row has no usable data ({} / null): surface it loudly instead of quietly
  // showing a fresh default estimate under the saved name (the "smith elemetry" bug).
  const [loadedBidEmpty, setLoadedBidEmpty] = useState(false);
  // Per-tab edit lock (docs: bid_locks). Another tab — any user, or this account in a second
  // window — makes this view read-only; when the holder leaves, this tab takes over and
  // re-hydrates from the saved row so it never edits a stale copy.
  const lockHolderName = profile?.full_name?.trim() || session?.user.email || "Another user";
  const bidLock = useBidLock({
    bidId: bidParam,
    enabled: authed,
    holderName: lockHolderName,
    onAcquired: (firstTime) => {
      if (firstTime) return;
      hydratedFor.current = null;
      void qc.invalidateQueries({ queryKey: ["bid", bidParam] });
    },
  });
  const readOnly = bidLock.readOnly;
  const ro = readOnly ? { inert: true } : {};
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
  // Legacy Estimate.FormulasVersion: new bids take the current version; a loaded bid keeps its
  // stamp until "Upgrade to Latest Formulas" (Update Bid Options).
  const [formulasVersion, setFormulasVersion] = useState<string>(CURRENT_FORMULAS_VERSION);
  const [updateOpen, setUpdateOpen] = useState(false);
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
  >({ wallType: 4 });
  const [underlaymentAttachmentDefault, setUnderlaymentAttachmentDefault] = useState<
    "mechanical" | "adhesive" | "none" | "durobond"
  >("mechanical");
  // Legacy Home General Info: Building Type + Date Created (Estimate.StartDate, editable).
  const [buildingType, setBuildingType] = useState<string>("Commercial");
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  // Legacy per-estimate sales tax (null = the company settings; Tax Exempt zeroes it).
  const [salesTaxRate, setSalesTaxRate] = useState<number | null>(null);
  // Legacy frmULSqFtPopUp: per-bid underlayment $/sqft by board (0/absent = admin price).
  const [underlaymentPriceOverrides, setUnderlaymentPriceOverrides] = useState<
    Record<string, number>
  >({});
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
  // Set on a bid the Bid Combiner produced (legacy Description text); persisted until dismissed.
  const [combineInfo, setCombineInfo] = useState<CombineInfo | undefined>(undefined);
  const [bidStatus, setBidStatus] = useState<BidStatus>("draft");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  // Bid total panel starts minimized (just the grand total); the choice is remembered per browser.
  const [bidTotalOpen, setBidTotalOpen] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("bidTotalOpen") === "1";
    } catch {
      return false;
    }
  });
  const toggleBidTotal = () =>
    setBidTotalOpen((o) => {
      try {
        localStorage.setItem("bidTotalOpen", o ? "0" : "1");
      } catch {
        /* storage unavailable — keep in-memory state only */
      }
      return !o;
    });

  // Underlayment step (legacy Underlayment/Insulation screen): section multi-select + the
  // pending layer being configured (board / attachment) before it's applied to the selection.
  const [uSel, setUSel] = useState<string[]>([]);
  const [uTab, setUTab] = useState(0); // 0..MAX_UNDERLAYMENT_LAYERS-1 → Layer 1..5
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
  const [uEnhSpacing, setUEnhSpacing] = useState(0); // field ribbon spacing; 0 = default coverage
  const [uEnhSpacingPerim, setUEnhSpacingPerim] = useState(0); // perimeter/corner; 0 = same as field
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
  // Legacy: the price link re-opens an existing quote PRE-FILLED (HandleGetQuote edit path →
  // frmULQuote.DoPopup "Edit Quote n"); frmQuoteDecision (§10.7) merges amounts; or start new.
  const [qMode, setQMode] = useState<"edit" | "merge" | "new">("edit");
  // frmFluteFillerCalc inputs (§10.7): piece length (ft), ridge-to-ridge (in), waste %.
  const [qFfLen, setQFfLen] = useState(8);
  const [qFfR2R, setQFfR2R] = useState(24);
  const [qFfPlus, setQFfPlus] = useState(0);
  // Adhered-layer quote containers over tapered surfaces (§10.7 QuoteAdhesiveUnits).
  const [uQAU, setUQAU] = useState(0);
  /** Fill the quote form from a saved quote (edit), or blank it (merge / new). */
  const fillQuoteForm = (q: UnderlaymentLayer["quote"] | undefined, name: string) => {
    setQName(name);
    setQPieceMode(!!q?.pieceMode);
    setQLump(q?.lumpSum ?? 0);
    setQPieces(q?.pieces ?? 0);
    setQCpp(q?.costPerPiece ?? 0);
    setQLabor(q?.laborAmount ?? 0);
    setQLaborDays(!!q?.laborInDays);
  };
  const openQuoteDialog = (board: string) => {
    // When the selection already carries this board's quote, open it pre-filled (legacy edit).
    const ex = existingQuoteFor(board);
    fillQuoteForm(ex, ex?.name ?? "New Quote");
    setQMode("edit");
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
  /**
   * Legacy: selecting a layer (tab or the stack graphic) shows THAT layer's product — its price
   * per sq ft line, or its quote — so the picker follows the layer the user clicked.
   */
  const selectLayerTab = (n: number) => {
    setUTab(n);
    const first = sections.find((x) => uSel.includes(x.id)) ?? sections[0];
    const l = first ? sectionLayers(first)[n] : undefined;
    if (l?.board) {
      setUBoard(l.board);
      setUGroup(null);
    }
  };
  const [uAttach, setUAttach] = useState<"mechanical" | "adhesive" | "none" | "durobond">(
    "mechanical",
  );
  // Legacy frmUnderlayment.LoadAttachment (docs §22.28): a Duro-Bond selection forces "Section
  // Fastened w/ Durobond" whatever the picker last held — the hints and the applied layer follow it.
  const uAttachEffective: UAttach = (() => {
    const picked = sections.filter((x) => uSel.includes(x.id));
    const db =
      picked.length > 0
        ? picked.some((x) => (x.roofSystem ?? roofSystem) === "Duro-Bond")
        : roofSystem === "Duro-Bond";
    return db ? "durobond" : uAttach;
  })();
  // Legacy Underlayment "Adjustable Labor for selected Roof Sections" link (AdjustUnderlaymentLabor).
  const [uLaborOpen, setULaborOpen] = useState(false);
  const [uLaborPct, setULaborPct] = useState(0);
  const [uAdh, setUAdh] = useState("");

  // Tear-Off step (legacy multi-select pattern): section selection + the pending options.
  const [toSel, setToSel] = useState<string[]>([]);
  const [toType, setToType] = useState("");
  const [toDepth, setToDepth] = useState(0);
  // Legacy frmTearoff.llbItemLabor: TO_Additional (whole percent) on the selected sections.
  const [toLaborOpen, setToLaborOpen] = useState(false);
  const [toLaborPct, setToLaborPct] = useState(0);

  // Load a saved bid when arriving with ?bid=<id>, and hydrate the form once.
  const { data: loadedBid } = useQuery({
    queryKey: ["bid", bidParam],
    queryFn: () => getBidFn({ data: { id: bidParam! } }),
    enabled: authed && !!bidParam,
  });
  const hydratedFor = useRef<string | null>(null);
  // Bumped when a saved bid finishes hydrating so the unsaved-changes baseline is captured
  // from the hydrated state (not the empty pre-load render).
  const [hydrationStamp, setHydrationStamp] = useState(0);
  /**
   * Hydrate the form from a saved payload (a loaded bid, or the Bid Combiner's merged result).
   * `d.sections` must be an array. Also moves the new-section / parapet / curb id counters past
   * the ids already in use so an added item never collides with a loaded one.
   */
  const hydrateSaved = (
    d: Partial<SavedBidState> & { sections: BidSectionInput[] },
    meta: { createdAt?: string | undefined; updatedAt?: string | undefined },
  ) => {
    setRoofSystem(d.roofSystem ?? "Duro-Last");
    setAttachment(d.attachment ?? "mechanical");
    setMembraneAdhesive(d.membraneAdhesiveName ?? "Water Based Adhesive");
    setSections(d.sections.map((s) => ({ ...s, layers: sectionLayers(s) })));
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
    setHoursPerDay(d.hoursPerDay !== undefined && d.hoursPerDay > 0 ? d.hoursPerDay : undefined);
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
    setFormulasVersion(d.formulasVersion ?? CURRENT_FORMULAS_VERSION);
    setWarrantyName(d.warrantyName ?? "");
    if (d.sectionDefaults) setSectionDefaults({ designTable: 60, ...d.sectionDefaults });
    setParapetDefaults(d.parapetDefaults ? { ...d.parapetDefaults } : { wallType: 4 });
    // Legacy frmUnderlayment.LoadAttachment lists the Duro-Bond options first on a Duro-Bond
    // bid, so "Section Fastened w/ Durobond" is the default there.
    const uDefault =
      d.underlaymentAttachmentDefault ?? (d.roofSystem === "Duro-Bond" ? "durobond" : "mechanical");
    setUnderlaymentAttachmentDefault(uDefault);
    setUAttach(uDefault);
    setBuildingType(d.buildingType ?? "Commercial");
    setStartDate(d.startDate ?? (meta.createdAt ?? new Date().toISOString()).slice(0, 10));
    setSalesTaxRate(d.salesTaxRate ?? null);
    setUnderlaymentPriceOverrides(d.underlaymentPriceOverrides ?? {});
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
            asOf: d.pricingAsOf ?? meta.updatedAt ?? new Date().toISOString(),
          }
        : null,
    );
    setCombineInfo(d.combineInfo);
    const bump = (ids: string[], prefix: string, cur: number) =>
      Math.max(
        cur,
        ...ids.map((id) => {
          const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
          return m ? Number(m[1]) + 1 : 0;
        }),
      );
    seq = bump(
      d.sections.map((x) => x.id),
      "s",
      seq,
    );
    pseq = bump(
      (d.parapets ?? []).map((x) => x.id),
      "p",
      pseq,
    );
    cseq = bump(
      (d.curbs ?? []).map((x) => x.id),
      "c",
      cseq,
    );
  };
  useEffect(() => {
    if (!loadedBid || hydratedFor.current === loadedBid.id) return;
    const d = loadedBid.data as unknown as Partial<SavedBidState> | null;
    setLoadedBidEmpty(!(d && Array.isArray(d.sections)));
    if (d && Array.isArray(d.sections)) {
      hydrateSaved(d as Partial<SavedBidState> & { sections: BidSectionInput[] }, {
        createdAt: (loadedBid as { created_at?: string }).created_at,
        updatedAt: loadedBid.updated_at,
      });
    }
    setBidId(loadedBid.id);
    setBidName(loadedBid.name);
    setBidStatus(asBidStatus(loadedBid.status));
    hydratedFor.current = loadedBid.id;
    setHydrationStamp((n) => n + 1);
  }, [loadedBid]);

  // Bid Combiner (legacy BidAdvantage.BidCombiner, docs §22.41): ?combine=<id>,<id>,… loads the
  // source bids and merges them into THIS (new, unsaved) bid on top of the fresh defaults.
  const combineIds = useMemo(
    () =>
      (combineParam ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    [combineParam],
  );
  const { data: combineSources, error: combineError } = useQuery({
    queryKey: ["combine", combineParam],
    queryFn: () => Promise.all(combineIds.map((id) => getBidFn({ data: { id } }))),
    enabled: authed && !bidParam && combineIds.length >= 2,
  });
  const combinedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!combineSources || !combineParam || combinedFor.current === combineParam) return;
    combinedFor.current = combineParam;
    const sources = combineSources
      .filter((b): b is NonNullable<typeof b> => !!b)
      .map((b) => ({
        id: b.id,
        name: b.name,
        saved: (b.data ?? {}) as Partial<SavedBidState>,
      }));
    if (sources.length < 2) {
      toast.error("Could not load two or more bids to combine.");
      return;
    }
    try {
      const { saved: merged } = combineSavedBids(sources, saved);
      hydrateSaved(merged, {});
      setBidId(undefined);
      setBidName("Combined Bid");
      setBidStatus("draft");
      // No hydration stamp on purpose: the combined bid stays "unsaved" until it is saved.
      toast.success(`Combined ${sources.length} bids — review the steps in the notice, then save.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not combine these bids.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- combine once per ?combine value
  }, [combineSources, combineParam]);
  useEffect(() => {
    if (combineError)
      toast.error(
        combineError instanceof Error ? combineError.message : "Could not load the bids.",
      );
  }, [combineError]);

  // NEW bids start from the seeded admin default (legacy Labor & Markup Options "Default":
  // $45/hr, 35% gross profit) instead of hardcoded fallbacks; saved bids keep their own values.
  const appliedDefaultPreset = useRef(false);
  // New bids default "Estimator's Name" to the signed-in user (a loaded bid keeps its own).
  useEffect(() => {
    if (bidParam) return;
    const me = (profile?.full_name ?? "").trim() || (profile?.email ?? "").trim();
    if (!me) return;
    setCustomer((c) => (c.estimatorName ? c : { ...c, estimatorName: me }));
  }, [profile, bidParam]);

  // NEW bids start on the admin default labor template (legacy Estimate ctor seeds its adjusts
  // from oRefTemplates' default); saved bids keep whatever was written when they were built.
  const appliedDefaultTemplate = useRef(false);
  useEffect(() => {
    if (appliedDefaultTemplate.current || bidParam || !admin?.laborTemplates) return;
    appliedDefaultTemplate.current = true;
    const def = admin.laborTemplates.defaultName;
    if (def) applyTemplate(def);
    // applyTemplate closes over state; the ref guard makes this run once per new bid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, bidParam]);

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

  /** Attachments the admin labor combos offer for a roof system (parapets may differ from the roof). */
  const attachmentsForSystem = (rs: string): Array<"mechanical" | "adhered"> => {
    const out: Array<"mechanical" | "adhered"> = [];
    for (const k of Object.keys(admin?.labor ?? {})) {
      const [sys, att] = k.split("|");
      if (sys !== rs) continue;
      if (att === "mechanical") out.push("mechanical");
      else if (att === "adhesive" || att === "adhered") out.push("adhered");
    }
    return out.length ? out : ["mechanical"];
  };
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
  const adhesiveOptions = admin?.adhesiveTimes?.adhesives ?? [];
  const warrantyOptions = ["None", ...(warrantyData?.warranties.map((w) => w.name) ?? [])];
  const laborTemplateOptions = ["None", ...(admin?.laborTemplates?.names ?? [])];
  /** The estimate's hours per man-day: its own value, else the admin default. */
  const effectiveHoursPerDay =
    hoursPerDay !== undefined && hoursPerDay > 0 ? hoursPerDay : (admin?.settings.hoursPerDay ?? 9);
  // The selected template's percent adjustments (legacy Template fields). They are WRITTEN into
  // the items on selection (frmHome.updateTemplate) and seed new items (RoofSection / Parapet /
  // Curb ctors) — the engine never composes them at compute time (docs §20.3).
  const templateDeltas = useMemo(
    () => laborTemplateDeltas(admin, laborTemplateName),
    [admin, laborTemplateName],
  );
  /** Legacy frmHome.updateTemplate: select a template and write it into every item. */
  const applyTemplate = (name: string) => {
    setLaborTemplateName(name);
    const d = laborTemplateDeltas(admin, name);
    const w = applyLaborTemplate({ sections, parapets, curbs, accessoriesCalc }, d);
    setAdjustLaborPct(w.adjustLaborPct);
    setAdjustSetupPct(w.adjustSetupPct);
    setAdjustInspectionPct(w.adjustInspectionPct);
    setSections(w.sections);
    setParapets(w.parapets);
    setCurbs(w.curbs);
    setAccessoriesCalc(w.accessoriesCalc);
  };

  /**
   * Legacy frmHome.btnUpdate_Click (docs §22.39): the Update Bid Options dialog's OK. Material
   * pricing = replace the frozen snapshot with live admin data (custom underlayment quotes survive
   * unless reset; Non-DL overrides survive unless their box is ticked); labor template = re-apply
   * the template deltas over manual %s; latest formulas = re-stamp FormulasVersion.
   */
  const applyUpdateOptions = async (o: UpdateBidOptions) => {
    const done: string[] = [];
    if (o.materialPricing) {
      const [a, w] = await Promise.all([getFn(), getWarrantyFn()]);
      // Legacy NDLCollectionBase.UpdateManagement: Non-DL rows are stored copies — an un-ticked
      // field keeps the figure the bid already had (pinned from the OLD snapshot before it is
      // replaced); a ticked field reads the CURRENT management value.
      const oldRef = admin?.nonDl;
      setNonDlCalc((prev) =>
        pinNonDlToRef(prev, oldRef, {
          unitPrice: o.ndlUnitPrice,
          unitLabor: o.ndlUnitLabor,
          laborRate: o.ndlLaborRate,
        }),
      );
      setSnapshot({ admin: a, warranty: w ?? null, asOf: new Date().toISOString() });
      setLiveCheck({ admin: a, warranty: w ?? null });
      done.push("pricing & labor");
      if (o.resetUnderlaymentQuotes) {
        setUnderlaymentPriceOverrides({});
        done.push("underlayment quotes reset");
      }
      const ndl = [
        o.ndlUnitLabor ? "labor/unit" : "",
        o.ndlLaborRate ? "labor rate" : "",
        o.ndlUnitPrice ? "price/unit" : "",
      ].filter(Boolean);
      if (ndl.length) done.push(`Non-DL ${ndl.join(", ")} to management defaults`);
    }
    if (o.laborTemplate) {
      // Legacy PreserveLaborTemplate(True): the management template is looked up by name; when
      // it no longer exists the estimate keeps its own settings.
      if (laborTemplateName && admin?.laborTemplates?.byName[laborTemplateName]) {
        applyTemplate(laborTemplateName);
        done.push(`labor template "${laborTemplateName}"`);
      } else {
        toast.warning(
          laborTemplateName
            ? `Template "${laborTemplateName}" is no longer in management — labor settings kept.`
            : "No labor template is selected on this bid — labor settings kept.",
        );
      }
    }
    if (o.latestFormulas && formulasVersion !== CURRENT_FORMULAS_VERSION) {
      setFormulasVersion(CURRENT_FORMULAS_VERSION);
      done.push(`formulas ${CURRENT_FORMULAS_VERSION}`);
    }
    toast.success(`Bid updated (${done.join(", ")}) — totals recomputed. Save to keep it.`);
  };

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
    ...(hoursPerDay !== undefined && hoursPerDay > 0 ? { hoursPerDay } : {}),
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
    formulasVersion,
    sectionDefaults,
    parapetDefaults,
    underlaymentAttachmentDefault,
    ...(Object.values(underlaymentPriceOverrides).some((v) => v > 0)
      ? { underlaymentPriceOverrides }
      : {}),
    buildingType,
    startDate,
    ...(salesTaxRate !== null ? { salesTaxRate } : {}),
    ...(taxMaterialOnly !== null ? { taxMaterialOnly } : {}),
    ...(maxWindExpected !== undefined ? { maxWindExpected } : {}),
    warrantyName,
    highWind,
    highWindTermYears,
    highWindBand,
    ...(combineInfo ? { combineInfo } : {}),
  };
  // Unsaved-changes tracking: the serialized bid vs the last saved / hydrated baseline. Every
  // custom row (Non-DL custom items, metals entries, accessory quantities, quote layers) lives
  // in `saved`, so nothing is lost on save; leaving the page with edits pending asks first.
  const savedJson = JSON.stringify(saved);
  const lastSavedJson = useRef<string | null>(null);
  useEffect(() => {
    lastSavedJson.current = savedJson;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline only at mount / hydration
  }, [hydrationStamp]);
  const dirty = lastSavedJson.current !== null && savedJson !== lastSavedJson.current;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useBlocker({
    shouldBlockFn: () =>
      dirtyRef.current &&
      !window.confirm("This bid has unsaved changes. Leave without saving them?"),
    enableBeforeUnload: () => dirtyRef.current,
  });
  const bid: BidInput = {
    ...buildBidInput(saved, warrantyData),
    // Legacy MechFastenerLookup rows: the Duro-Tuff mechanical perimeter tiers key their
    // spacing by row width (docs §22.15).
    ...(fastenerLookup?.length ? { fastenerLookup } : {}),
  };
  // Legacy high-wind semantics: the warranty carries IsHighWind + its term; the bid picks the
  // Max Expected Wind band (docs §17).
  const effHighWind = warrantyData ? effectiveHighWind(saved, warrantyData) : null;
  const selectedWarranty = warrantyData?.warranties.find((w) => w.name === warrantyName);
  // Legacy frmMembTypeSelect: sections thinner than the warranty's ReqThickness.
  const thinSections = selectedWarranty?.reqThickness
    ? sections.filter((sec) => sec.thickness < selectedWarranty.reqThickness!)
    : [];
  // Legacy frmHome.TestForEnhancement on the default section (pull test 350, lap 60). Web-only
  // systems that do not ship a 60" roll (EPDM: 120" / 240") probe their narrowest offered width
  // instead — a 60" probe would find no row and flag every EPDM bid (docs §22.35 addendum).
  const defaultsEnhancement = (() => {
    if (!fastenerLookup?.length || attachment !== "mechanical") return null;
    const rsId = LEGACY_ROOF_SYSTEM_IDS[roofSystem];
    if (!rsId) return null;
    const offered = TAB_OPTIONS_BY_SYSTEM[roofSystem];
    const probeLap = !offered || offered.includes(60) ? 60 : Math.min(...offered);
    const r = universalFastenerSpacing(fastenerLookup, {
      roofSystemId: rsId,
      thickness: sectionDefaults.thickness,
      designTable: sectionDefaults.designTable ?? 60,
      tabSpacings: [probeLap],
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
    const {
      inputs,
      warnings,
      parapetMaterial,
      metalsMaterial,
      adhesiveMaterial,
      curbMaterial,
      slipSheetMaterial,
      reviewMembraneSqFtExtras,
    } = build;
    const accessoriesResult = build.accessories;
    const adhesiveWholeUnits = build.adhesiveWholeUnits;
    const r = computeEstimate(inputs);
    return {
      r,
      build,
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
      // The same hours before any AdjustLabor (legacy RoofSection.BaseHours) — the Labor link's
      // 100 % reference.
      sectionBaseHours: inputs.sections.map((rs) => {
        const { adjustLaborPct: _sectionAdjust, ...base } = rs;
        return computeSectionInstallHours(base, inputs.admin, inputs.formulasVersion, 0);
      }),
      warnings,
      parapetMaterial,
      metalsMaterial,
      adhesiveMaterial,
      curbMaterial,
      slipSheetMaterial,
      reviewMembraneSqFtExtras,
      // Own-rate direct-labor hours (metals + categorized non-DL); they join man-days but are
      // priced at each line's own rate, so they aren't in any crew-rate hour bucket.
      ownRateHours: inputs.ownRateDirectLaborHours ?? 0,
      // §12 Accessories calculated-screen results + the adhesive whole-unit Calc Qtys.
      accessories: accessoriesResult,
      adhesiveWholeUnits,
      adhesiveLines: build.adhesiveLines,
      // §13 EXCEPTIONAL Metals screen results (summary lines + dMaterial[5]/dLabor[5] totals).
      metalsScreen: build.metalsScreen,
      // §14 Non-Duro-Last Items results (six dialogs + auto rows; OtherMaterial / LS1 / LS2).
      nonDl: build.nonDl,
      // Per-curb legacy ManHours for the Curbs screen "Labor: X hours" readout.
      curbHoursById: build.breakdown.curbHoursById,
      // Per-wall legacy ManHours / BaseManHours for the Parapets screen labor link (§19).
      parapetHoursById: build.breakdown.parapetHoursById,
      parapetBaseHoursById: build.breakdown.parapetBaseHoursById,
      // Auto-priced ARP membrane (§8.6) — Duro-Last material shown with Accessories.
      arpMaterial: build.breakdown.arpMaterial,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, JSON.stringify(bid)]);

  // Legacy Underlayment screen readouts (frmUnderlayment.UpdateGraphic) for the selected sections:
  // Σ UnderlaymentBaseHours / UnderlaymentAdjustedBaseHours / UnderlaymentQuoteHours, and the
  // link suffix — " (N%)" with N = 100 + AdjustUnderlaymentLabor, or " (Dif.)" when they differ.
  const uSelLabor = useMemo(() => {
    const per = result?.build.inputs.underlaymentHoursBySection ?? {};
    const sel = sections.filter((x) => uSel.includes(x.id));
    let base = 0;
    let adjusted = 0;
    let quote = 0;
    for (const x of sel) {
      const h = per[x.id];
      if (!h) continue;
      base += h.base;
      adjusted += h.adjusted;
      quote += h.quote;
    }
    const pcts = [
      ...new Set(sel.map((x) => x.adjustUnderlaymentLaborPct ?? templateDeltas.underlayment)),
    ];
    const pct = pcts.length === 1 ? pcts[0]! : null;
    const suffix =
      sel.length === 0 ? "" : pct === null ? " (Dif.)" : ` (${100 + Math.round(pct)}%)`;
    return { base, adjusted, quote, suffix, differing: pcts.length > 1 };
  }, [result, sections, uSel, templateDeltas]);

  // Legacy Tear-off screen readouts: per-section TearOffBaseLabor / TearOffLabor (the engine's
  // own per-section formula on the built inputs) and the selection's "Labor: X h (N%)" link.
  const toLabor = useMemo(() => {
    const byId: Record<string, { base: number; adjusted: number }> = {};
    for (const s of result?.build.inputs.sections ?? []) {
      const base = tearOffLaborForSection({
        length: s.length,
        width: s.width,
        tearOff: s.tearOff,
        laborLookup: s.tearOffLaborLookup,
        ...(s.tearOffSheetComplexityMulti !== undefined
          ? { sheetComplexityMulti: s.tearOffSheetComplexityMulti }
          : {}),
        additionalPct: 0,
      });
      byId[s.id] = { base, adjusted: base * (1 + s.tearOffAdditionalPct / 100) };
    }
    const sel = sections.filter((x) => toSel.includes(x.id));
    let base = 0;
    let adjusted = 0;
    for (const x of sel) {
      const h = byId[x.id];
      if (!h) continue;
      base += h.base;
      adjusted += h.adjusted;
    }
    const pcts = [...new Set(sel.map((x) => x.tearOffAdditionalPct ?? 0))];
    const pct = pcts.length === 1 ? pcts[0]! : null;
    const suffix =
      sel.length === 0 ? "" : pct === null ? " (Dif.)" : ` (${100 + Math.round(pct)}%)`;
    return { byId, base, adjusted, suffix, differing: pcts.length > 1 };
  }, [result, sections, toSel]);

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

  // Order list (inventory phase 2, src/lib/order-list.ts): what to BUY, from the same engine lines
  // the bid bills, less what the stock ledger has on hand. Price is never affected.
  const stockFn = useServerFn(listStock);
  const targetsFn = useServerFn(listPriceTargets);
  const { data: stockRows } = useQuery({
    queryKey: ["inventory-stock"],
    queryFn: () => stockFn(),
    enabled: authed && STEPS[step]?.key === "review",
  });
  const { data: priceTargets } = useQuery({
    queryKey: ["price-targets"],
    queryFn: () => targetsFn(),
    enabled: authed && STEPS[step]?.key === "review",
  });
  // Phase 3: what this bid already pulled from stock (consumed / released entries), and the
  // Pull / Return actions that write them. A pull needs a saved bid (the entry carries its id).
  const movesFn = useServerFn(listMovements);
  const addMoveFn = useServerFn(addMovement);
  const { data: bidPulls } = useQuery({
    queryKey: ["bid-pulls", bidId],
    queryFn: () => movesFn({ data: { bid_id: bidId!, limit: 1000 } }),
    enabled: authed && STEPS[step]?.key === "review" && !!bidId,
  });
  const orderList: OrderLine[] = useMemo(() => {
    if (!result || !admin || !priceTargets) return [];
    try {
      return buildOrderList({
        admin,
        roofSystem,
        attachment,
        sections,
        build: result.build,
        targets: priceTargets,
        stock: stockRows ?? [],
        pulls: bidPulls ?? [],
      });
    } catch {
      return [];
    }
  }, [result, admin, priceTargets, stockRows, bidPulls, roofSystem, attachment, sections]);
  const [orderOpen, setOrderOpen] = useState(false);
  const orderHeader = () => ({
    bidName,
    client: customer.name || undefined,
    jobSite:
      [customer.projectAddress, customer.jobCityStZip].filter(Boolean).join(", ") || undefined,
  });
  const exportOrderExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [`Order list — ${bidName}`],
      [
        orderHeader().client ?? "",
        orderHeader().jobSite ?? "",
        `printed ${new Date().toLocaleString()}`,
      ],
      [],
      ORDER_COLUMNS,
      ...orderListRows(orderList),
    ]);
    ws["!cols"] = [
      { wch: 13 },
      { wch: 48 },
      { wch: 10 },
      { wch: 16 },
      { wch: 11 },
      { wch: 14 },
      { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order list");
    XLSX.writeFile(
      wb,
      `${bidName.replace(/[\\/:*?"<>|]+/g, " ").trim() || "bid"} - order list.xlsx`,
    );
  };
  const printOrderList = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      toast.error("Allow pop-ups to print the order list");
      return;
    }
    w.document.write(orderListHtml(orderList, orderHeader()));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };
  const [pullQty, setPullQty] = useState<Record<string, string>>({});
  const [pulling, setPulling] = useState<string | null>(null);
  const pullKey = (l: OrderLine) =>
    l.cell ? `${l.cell.screen_id}|${l.cell.row_label}|${l.cell.price_col}` : l.name;
  const recordPull = async (l: OrderLine, reason: "consumed" | "released", qty: number) => {
    if (!l.cell || !bidId || qty <= 0) return;
    setPulling(pullKey(l));
    try {
      await addMoveFn({
        data: {
          screen_id: l.cell.screen_id,
          row_label: l.cell.row_label,
          price_col: l.cell.price_col,
          qty,
          reason,
          bid_id: bidId,
          note:
            reason === "consumed"
              ? "Pulled on the bid's Order list"
              : "Returned from the bid's Order list",
        },
      });
      toast.success(
        reason === "consumed"
          ? `Pulled ${describeOrderQty(l, qty)} from stock for this bid`
          : `Returned ${describeOrderQty(l, qty)} to stock`,
      );
      setPullQty((p) => ({ ...p, [pullKey(l)]: "" }));
      void qc.invalidateQueries({ queryKey: ["inventory-stock"] });
      void qc.invalidateQueries({ queryKey: ["inventory-movements"] });
      void qc.invalidateQueries({ queryKey: ["bid-pulls", bidId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record that");
    } finally {
      setPulling(null);
    }
  };

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

  /** Save the bid (create on first save). Resolves true on success, false when the save failed. */
  const handleSave = async (): Promise<boolean> => {
    if (readOnly) {
      toast.error(`Read only: ${bidLock.holder?.name ?? "another user"} is editing this bid.`);
      return false;
    }
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
          sessionKey: bidLock.sessionKey,
          name: bidName.trim() || "Untitled bid",
          data: payload as unknown as Record<string, unknown>,
          grandTotal,
          status: bidStatus,
        },
      });
      qc.invalidateQueries({ queryKey: ["bids"] });
      toast.success("Bid saved");
      lastSavedJson.current = savedJson;
      dirtyRef.current = false;
      if (!snapshot && snap) setSnapshot(snap);
      if (row && !bidId) {
        setBidId(row.id);
        hydratedFor.current = row.id;
        void navigate({ to: "/estimate", search: { bid: row.id }, replace: true });
      }
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };
  // Previous / Next save the bid before moving (every step is a checkpoint); a failed save
  // stays put.
  const saveAndGo = async (target: number) => {
    if (await handleSave()) goStep(target);
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
    <div
      className={`grid gap-6 pb-16 lg:pb-0 ${
        bidTotalOpen ? "lg:grid-cols-[1fr_320px]" : "lg:grid-cols-[1fr_220px]"
      }`}
    >
      <div className="space-y-6">
        {readOnly && bidLock.holder && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-md border border-orange-600 bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-sm"
          >
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              Read only mode: {bidLock.holder.name} is currently editing this bid
              {bidLock.holder.userId === session?.user.id ? " in another window" : ""}.
            </span>
            <span className="font-normal text-orange-50">
              You can look but not change anything — editing unlocks here automatically once they
              leave.
            </span>
          </div>
        )}
        {combineInfo && (
          <div
            role="status"
            className="space-y-1 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-300/10"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">Bid Combiner</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCombineInfo(undefined)}
                title="Remove this notice from the bid"
              >
                Dismiss
              </Button>
            </div>
            {combineWarningLines(combineInfo).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {combineInfo.conflicts.length > 0 && (
              <ul className="list-disc pl-5 text-xs">
                {combineInfo.conflicts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {loadedBidEmpty && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <span className="font-semibold">This saved bid has no stored data.</span> What you see
            below is a fresh default estimate under its name — nothing here was loaded from the
            save. Saving will write the current inputs over the empty record.
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight">Estimator</h1>

        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 p-1.5">
          {STEPS.map((st, i) => {
            const n = stepCount(st.key);
            return (
              <button
                key={st.key}
                type="button"
                onClick={() => goStep(i)}
                className={`rounded-md px-4 py-2 text-base font-bold tracking-tight transition-colors ${
                  step === i
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                {st.label}
                {n !== null && n > 0 ? ` (${n})` : ""}
              </button>
            );
          })}
          {/* Save is always in reach here (owner: no scrolling to save). */}
          <Button
            className="ml-auto"
            onClick={handleSave}
            disabled={saving || readOnly}
            title={
              readOnly
                ? "Read only"
                : dirty
                  ? "Unsaved changes — saves the bid and stays on this step"
                  : "Saves the bid and stays on this step"
            }
          >
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : bidId ? "Save" : "Save bid"}
            {dirty && !saving && (
              <span
                className="ml-1 h-2 w-2 rounded-full bg-amber-400"
                aria-label="Unsaved changes"
              />
            )}
          </Button>
          {/* Legacy frmHome.btnUpdate ("Update Pricing & Labor"): a standing button, set apart
              on the right in black; the dot marks management data newer than the bid's copy. */}
          <button
            type="button"
            onClick={() => setUpdateOpen(true)}
            disabled={readOnly}
            title={
              pricingStale
                ? `Management pricing / labor has changed since this bid was priced${frozenAsOf ? ` (${new Date(frozenAsOf).toLocaleDateString()})` : ""}`
                : "Update this bid from the current management data, template or formulas"
            }
            className="flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/85 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            <RefreshCw className="h-4 w-4" />
            Update pricing &amp; labor
            {pricingStale && (
              <span
                className="h-2 w-2 rounded-full bg-amber-400"
                aria-label="Management data has changed since this bid was priced"
              />
            )}
          </button>
        </div>

        <div className={step === 0 ? "grid items-start gap-4 xl:grid-cols-2" : "hidden"} {...ro}>
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
                        <PickOne
                          value={customer.estimatorName ?? ""}
                          // Roster from admin General → Estimators; a saved bid whose estimator
                          // is no longer on it keeps showing that name.
                          options={[
                            ...(estimatorNames ?? []),
                            ...(customer.estimatorName &&
                            !(estimatorNames ?? []).includes(customer.estimatorName)
                              ? [customer.estimatorName]
                              : []),
                          ]}
                          onChange={(v) => setCustomer((c) => ({ ...c, estimatorName: v }))}
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
                          applyTemplate(v === "None" ? "" : v);
                        }}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Selecting a template writes its % adjustments into every item&apos;s labor
                        (sections, underlayment, tear-off, parapets, curbs, accessories, setup,
                        inspection) — edit any of them afterwards.
                      </p>
                    </LegacyGroup>
                    <LegacyGroup title="4. Estimator Commission">
                      <Field label="Commission Rate (%)">
                        <NumberField
                          step="0.1"
                          value={commission}
                          onChange={(v) => setCommission(v)}
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
                        <NumberField
                          step="0.01"
                          className="w-[120px]"
                          disabled={taxExempt}
                          value={taxExempt ? 0 : Math.round(effSalesTaxRate * 100 * 10000) / 10000}
                          onChange={(v) => setSalesTaxRate(v / 100)}
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
                    <AutoTextarea
                      rows={3}
                      placeholder="Shown on the proposal…"
                      value={customer.notes}
                      onChange={(e) => setCustomer((c) => ({ ...c, notes: e.target.value }))}
                    />
                    {customer.perDiemChart ? (
                      <div className="mt-2">
                        <PerDiemChartEditor
                          chart={normalizePerDiemChart(customer.perDiemChart)}
                          onChange={(chart) => setCustomer((c) => ({ ...c, perDiemChart: chart }))}
                          onRemove={() =>
                            setCustomer((c) => {
                              const { perDiemChart: _drop, ...rest } = c;
                              return rest;
                            })
                          }
                          disabled={readOnly}
                        />
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={readOnly}
                        onClick={() =>
                          setCustomer((c) => ({ ...c, perDiemChart: emptyPerDiemChart() }))
                        }
                        title="Adds a 'Per diem based on N men N days' chart with a checklist of job costs and prices"
                      >
                        Add per diem chart
                      </Button>
                    )}
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
                    onChange={(v) => {
                      const wallType = v === "Brick or Concrete" ? 4 : 1;
                      setParapetDefaults((p) => ({ ...p, wallType }));
                      // Legacy only seeds NEW walls from this default (defaultParapet.WallType);
                      // the owner expects the bid-level wall type to re-route the existing walls'
                      // term-bar drill split too (docs §22.30), so it is applied to every wall.
                      // A wall can still be overridden on the Parapets screen afterwards.
                      if (parapets.length > 0) {
                        setParapets((prev) => prev.map((pp) => ({ ...pp, wallType })));
                        toast.info(
                          `${v} applied to ${parapets.length} parapet${parapets.length === 1 ? "" : "s"} — term bar / fascia drill split follows it.`,
                        );
                      }
                    }}
                  />
                </LegacyGroup>
              </div>
              <LegacyGroup title="3. Roof Sections Material">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Roof System">
                    <Select
                      value={roofSystem}
                      onValueChange={(v) => {
                        setRoofSystem(v);
                        // The new system's thickness list (Duro-Tech TPO 45/60/80, default 60
                        // per the owner's guide; legacy 40/50/60). Snap an invalid default.
                        const lt =
                          admin.labor[
                            `${v}|${attachment === "adhered" ? "adhesive" : "mechanical"}`
                          ] ??
                          admin.labor[`${v}|mechanical`] ??
                          admin.labor[`${v}|adhesive`];
                        const mils = Object.keys(lt?.thicknessLaborByMil ?? {})
                          .map(Number)
                          .filter((n) => n > 0);
                        if (mils.length && !mils.includes(sectionDefaults.thickness))
                          setSectionDefaults((p) => ({
                            ...p,
                            thickness: mils.includes(60) ? 60 : mils[0]!,
                          }));
                      }}
                    >
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
                    {(() => {
                      // Legacy frmHome.LoadAttachmentSystem: the system's fasteners entry plus
                      // the adhesives it has coverage rows for (Duro-Bond: fasteners only).
                      const opts = attachedWithOptions(admin, roofSystem, "roof");
                      const cur = attachedWithLabel(opts, attachment, membraneAdhesive);
                      return (
                        <PickOne
                          value={cur}
                          options={withCurrent(
                            opts.map((o) => o.label),
                            cur,
                          )}
                          onChange={(v) => {
                            const o = opts.find((x) => x.label === v);
                            if (!o) return;
                            setAttachment(o.attachment);
                            if (o.attachment === "adhered") setMembraneAdhesive(o.adhesiveName);
                          }}
                        />
                      );
                    })()}
                  </Field>
                  <Field label="Type">
                    <PickOne
                      value={String(sectionDefaults.thickness)}
                      options={(() => {
                        const mils = Object.keys(admin.labor[comboKey]?.thicknessLaborByMil ?? {})
                          .map(Number)
                          .filter((n) => n > 0)
                          .sort((a, b) => a - b)
                          .map(String);
                        const base = mils.length ? mils : ["40", "50", "60"];
                        return withCurrent(base, String(sectionDefaults.thickness));
                      })()}
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
                  {(() => {
                    // Legacy frmHome.LoadDefaultUnderlaymentAttachment (0x5bcd0): "None" first;
                    // on a Duro-Bond membrane the combo is DISABLED (the board is held by the
                    // induction plates — the Underlayment screen lists "Section Fastened w/
                    // Durobond" there); otherwise Duro-Last Fasteners, plus the insulation
                    // adhesives only when the MEMBRANE itself is adhered.
                    const isBond = roofSystem === "Duro-Bond";
                    const opts = isBond
                      ? [U_ATTACH_LABEL.none]
                      : [
                          U_ATTACH_LABEL.none,
                          U_ATTACH_LABEL.mechanical,
                          ...(attachment === "adhered" ? [U_ATTACH_LABEL.adhesive] : []),
                        ];
                    const cur = U_ATTACH_LABEL[underlaymentAttachmentDefault];
                    return (
                      <PickOne
                        value={isBond || !opts.includes(cur) ? U_ATTACH_LABEL.none : cur}
                        options={opts}
                        disabled={isBond}
                        onChange={(v) => {
                          const next = uAttachFromLabel(v);
                          setUnderlaymentAttachmentDefault(next);
                          setUAttach(next);
                        }}
                      />
                    );
                  })()}
                  <span className="text-xs text-muted-foreground">
                    (will not apply to existing underlayment)
                  </span>
                </div>
              </LegacyGroup>
              <LegacyGroup title="5. Parapets Material">
                <p className="mb-2 text-xs text-muted-foreground">
                  Parapets may run a different membrane than the roof sections. These are the
                  defaults for NEW walls (and &quot;Apply to Existing Parapets&quot;); each
                  wall&apos;s own Membrane Options on the Parapets step can still differ.
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Roof System">
                    <PickOne
                      value={parapetDefaults.roofSystem ?? roofSystem}
                      options={
                        systemOptions.includes(parapetDefaults.roofSystem ?? roofSystem)
                          ? systemOptions
                          : [parapetDefaults.roofSystem ?? roofSystem, ...systemOptions]
                      }
                      onChange={(v) =>
                        setParapetDefaults((p) => {
                          const nx = { ...p };
                          if (v === roofSystem) delete nx.roofSystem;
                          else nx.roofSystem = v;
                          const atts = attachmentsForSystem(v);
                          const cur = nx.attachment ?? attachment;
                          if (!atts.includes(cur)) nx.attachment = atts[0]!;
                          return nx;
                        })
                      }
                    />
                  </Field>
                  <Field label="Attached With">
                    {(() => {
                      // Legacy frmHome.LoadParapetAttachmentSystem: fasteners + the wall
                      // adhesives (RoofSystem.WallAdhesives) of the parapet system.
                      const opts = attachedWithOptions(
                        admin,
                        parapetDefaults.roofSystem ?? roofSystem,
                        "wall",
                      );
                      const curAtt = parapetDefaults.attachment ?? attachment;
                      const curAdh = parapetDefaults.membraneAdhesiveName ?? membraneAdhesive;
                      const cur = attachedWithLabel(opts, curAtt, curAdh);
                      return (
                        <PickOne
                          value={cur}
                          options={withCurrent(
                            opts.map((o) => o.label),
                            cur,
                          )}
                          onChange={(v) => {
                            const o = opts.find((x) => x.label === v);
                            if (!o) return;
                            setParapetDefaults((p) => {
                              const nx = { ...p };
                              if (o.attachment === attachment && nx.roofSystem === undefined)
                                delete nx.attachment;
                              else nx.attachment = o.attachment;
                              if (o.attachment !== "adhered" || o.adhesiveName === membraneAdhesive)
                                delete nx.membraneAdhesiveName;
                              else nx.membraneAdhesiveName = o.adhesiveName;
                              return nx;
                            });
                          }}
                        />
                      );
                    })()}
                  </Field>
                  {/* Owner: show the actual bid value rather than "Bid default"; picking the
                      bid's own value keeps the parapets following the bid. */}
                  <Field label="Type">
                    <PickOne
                      value={String(parapetDefaults.thicknessMil ?? sectionDefaults.thickness)}
                      options={[...new Set([String(sectionDefaults.thickness), "40", "50", "60"])]}
                      onChange={(v) =>
                        setParapetDefaults((p) => {
                          const nx = { ...p };
                          if (Number(v) === sectionDefaults.thickness) delete nx.thicknessMil;
                          else nx.thicknessMil = Number(v);
                          return nx;
                        })
                      }
                    />
                  </Field>
                  <Field label="Color">
                    <PickOne
                      value={parapetDefaults.color ?? sectionDefaults.color}
                      options={[...new Set([sectionDefaults.color, ...colorOptions])]}
                      onChange={(v) =>
                        setParapetDefaults((p) => {
                          const nx = { ...p };
                          if (v === sectionDefaults.color) delete nx.color;
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
                    // Legacy Button1_Click_1: membrane type + color onto every present parapet;
                    // owner: the Setup Deck Type and Wall Type go onto them too.
                    setParapets((prev) =>
                      prev.map((pp) => {
                        const nx: ParapetInput = {
                          ...pp,
                          deckType: sectionDefaults.deckType,
                          wallType: parapetDefaults.wallType ?? 4,
                        };
                        // Roof System / Attached With / adhesive: the defaults when they differ
                        // from the bid material, else back to "bid default".
                        if (parapetDefaults.roofSystem) nx.roofSystem = parapetDefaults.roofSystem;
                        else delete nx.roofSystem;
                        if (parapetDefaults.attachment) nx.attachment = parapetDefaults.attachment;
                        else delete nx.attachment;
                        if (parapetDefaults.membraneAdhesiveName)
                          nx.membraneAdhesiveName = parapetDefaults.membraneAdhesiveName;
                        else delete nx.membraneAdhesiveName;
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
                    <NumberField step="0.01" value={laborRate} onChange={(v) => setLaborRate(v)} />
                  </Field>
                  <Field label="Hours per Man Day">
                    <NumberField
                      step="0.5"
                      min={0}
                      value={hoursPerDay ?? admin.settings.hoursPerDay}
                      onChange={(v) =>
                        setHoursPerDay(v > 0 && v !== admin.settings.hoursPerDay ? v : undefined)
                      }
                    />
                  </Field>
                  <Field label="Man-Day Labor">
                    <NumberField
                      step="0.01"
                      value={Math.round(laborRate * effectiveHoursPerDay * 100) / 100}
                      onChange={(v) =>
                        effectiveHoursPerDay > 0 && setLaborRate(v / effectiveHoursPerDay)
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
                      <NumberField
                        className="w-[140px]"
                        value={markup}
                        onChange={(v) => setMarkup(v)}
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
                    <Field label="Per Diem ($/man-day — the Review's calculator takes a flat total)">
                      <NumberField
                        className="h-8 w-[120px]"
                        value={perDiem}
                        onChange={(v) => setPerDiem(v)}
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
                  Pressing OK will apply these defaults to ALL existing Roof Sections: Deck Type,
                  Roof System, Attached With, Design Table, Membrane Type, Color — and the &quot;2.
                  Wall Type&quot; default to every existing parapet (term bar / fascia drill split).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
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
                          // "1. Deck Type" too (owner's request; legacy OverwriteWithDefault
                          // leaves DeckType alone — docs §22.30).
                          deckType: sectionDefaults.deckType,
                          designTable: sectionDefaults.designTable ?? 60,
                          thickness: sectionDefaults.thickness,
                          color: sectionDefaults.color,
                        };
                      }),
                    );
                    // Owner's expectation (docs §22.30): the "2. Wall Type" default beside these
                    // material defaults re-routes the existing walls' drill split as well.
                    const wallType = parapetDefaults.wallType;
                    if (wallType !== undefined && parapets.length > 0)
                      setParapets((prev) => prev.map((pp) => ({ ...pp, wallType })));
                  }}
                >
                  OK
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className={step === 1 ? "space-y-6" : "hidden"} {...ro}>
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
                        sectionBaseHours: result.sectionBaseHours,
                        setupHours: result.r.setupHours,
                        inspectionHours: result.r.inspectionHours,
                        roofSqFt: result.r.roofSqFootage,
                        membraneSqFt: result.r.sqFtTotalMembrane,
                      }
                    : null
                }
                newSection={() =>
                  // Legacy RoofSection ctor: seeds AdjustUnderlaymentLabor / TO_Additional from the
                  // estimate's template (AdjustLabor comes from the bid-level default).
                  newSection({ ...sectionDefaults, ...seedSectionAdjust(templateDeltas) })
                }
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
        <div className={step === 2 ? "space-y-6" : "hidden"} {...ro}>
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
                      <TableHead className="w-8" title="Tick to select several sections" />
                      <TableHead>ID</TableHead>
                      <TableHead>W × L</TableHead>
                      {LAYER_SLOTS.map((li) => (
                        <TableHead key={li}>Layer {li + 1} : Attachment</TableHead>
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
                          // One click moves the selection to this section (legacy grid click);
                          // the checkbox adds/removes it for a multi-section apply.
                          onClick={() => setUSel([s.id])}
                          className={sel ? "cursor-pointer bg-primary/15" : "cursor-pointer"}
                        >
                          <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 align-middle"
                              checked={sel}
                              aria-label={`Select ${s.name}`}
                              onChange={() =>
                                setUSel((prev) =>
                                  prev.includes(s.id)
                                    ? prev.filter((x) => x !== s.id)
                                    : [...prev, s.id],
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell className="tabular-nums">
                            {s.width}x{s.length}
                          </TableCell>
                          {LAYER_SLOTS.map((li) => {
                            const l = sLayers[li];
                            return (
                              <TableCell key={li} className="whitespace-nowrap text-xs">
                                {l
                                  ? l.quote
                                    ? `${l.board} : quote “${l.quote.name}”`
                                    : `${l.board} : ${(() => {
                                        const att = effectiveLayerAttachment(
                                          l,
                                          (s.roofSystem ?? roofSystem) === "Duro-Bond",
                                        );
                                        return att === "mechanical"
                                          ? "Mech"
                                          : att === "durobond"
                                            ? "Duro-Bond"
                                            : att === "none"
                                              ? "None"
                                              : l.adhesiveName || "Adhesive";
                                      })()}`
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
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  disabled={uSel.length === 0}
                  onClick={() => {
                    const first = sections.find((x) => uSel.includes(x.id));
                    setULaborPct(first?.adjustUnderlaymentLaborPct ?? templateDeltas.underlayment);
                    setULaborOpen(true);
                  }}
                  title="Calculated underlayment hours of the selected sections after their labor adjustment (100% = as calculated). Click to change the hours or the percent."
                >
                  Adjustable Labor for selected Roof Sections:{" "}
                  <span className="tabular-nums">{uSelLabor.adjusted.toFixed(2)} h</span>
                  {uSelLabor.suffix}
                </button>
                <span title="Quote labor hours of the selected sections (never adjusted; a shared quote counts once)">
                  Quote labor for selected Roof Sections:{" "}
                  <span className="font-semibold tabular-nums">{uSelLabor.quote.toFixed(2)}</span>
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

              {/* Legacy frmLaborPopUp for the Underlayment screen: AdjustUnderlaymentLabor on the
                  selected sections (the template writes the same field; quote labor is never
                  adjusted). */}
              <LaborAdjustDialog
                open={uLaborOpen}
                onOpenChange={setULaborOpen}
                title="Underlayment Labor Adjustment"
                scope={`${sections.filter((x) => uSel.includes(x.id)).length} selected section(s)`}
                note="Quote labor is never adjusted."
                baseHours={uSelLabor.base}
                differing={uSelLabor.differing}
                pct={uLaborPct}
                onPct={setULaborPct}
                templateDefault={{
                  pct: templateDeltas.underlayment,
                  onUse: () => {
                    setSections((prev) =>
                      prev.map((x) =>
                        uSel.includes(x.id)
                          ? { ...x, adjustUnderlaymentLaborPct: templateDeltas.underlayment }
                          : x,
                      ),
                    );
                    setULaborOpen(false);
                  },
                }}
                onFinish={() => {
                  setSections((prev) =>
                    prev.map((x) =>
                      uSel.includes(x.id) ? { ...x, adjustUnderlaymentLaborPct: uLaborPct } : x,
                    ),
                  );
                  setULaborOpen(false);
                }}
              />

              <div className="grid items-start gap-4 lg:grid-cols-2">
                {/* Layer tabs + stack visual (legacy bottom-left) */}
                <div className="rounded-md border">
                  <div className="flex border-b">
                    {LAYER_SLOTS.map((n) => {
                      // Legacy tab: the layer's board glyph + "Layer n"; "Add Layer n" when empty.
                      const tabSec = sections.find((s) => uSel.includes(s.id)) ?? sections[0];
                      const tl = tabSec ? sectionLayers(tabSec)[n] : undefined;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => selectLayerTab(n)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium ${
                            uTab === n
                              ? "border-b-2 border-primary text-primary"
                              : "text-muted-foreground"
                          }`}
                        >
                          {tl && (
                            <TileGlyph
                              tile={admin.underlaymentGroups?.groupIdByBoard?.[tl.board]}
                              className="h-4 w-8 shrink-0"
                            />
                          )}
                          {tl ? `Layer ${n + 1}` : `Add Layer ${n + 1}`}
                        </button>
                      );
                    })}
                  </div>
                  <div className="p-4">
                    {(() => {
                      const stackSec = sections.find((s) => uSel.includes(s.id)) ?? sections[0];
                      const stackLayers = stackSec ? sectionLayers(stackSec) : [];
                      return (
                        <div className="space-y-2">
                          <LayerStack
                            slotsTopDown={LAYER_SLOTS_TOP_DOWN}
                            layers={stackLayers}
                            selected={uTab}
                            onSelect={selectLayerTab}
                            deckLabel={stackSec ? `Deck (${stackSec.deckType})` : "Deck"}
                            attachmentOf={(l) =>
                              effectiveLayerAttachment(
                                l,
                                (stackSec?.roofSystem ?? roofSystem) === "Duro-Bond",
                              )
                            }
                            tileOf={(board) => admin.underlaymentGroups?.groupIdByBoard?.[board]}
                            quoteText={(l) =>
                              l.quote
                                ? `“${l.quote.name}” — ${money(
                                    l.quote.pieceMode
                                      ? (l.quote.pieces ?? 0) * (l.quote.costPerPiece ?? 0)
                                      : (l.quote.lumpSum ?? 0),
                                  )} + ${l.quote.laborAmount ?? 0}${l.quote.laborInDays ? "d" : "h"} labor`
                                : null
                            }
                          />
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
                  <div className="flex flex-wrap items-end gap-3 text-xs text-muted-foreground">
                    {(() => {
                      const first = sections.find((x) => uSel.includes(x.id)) ?? sections[0];
                      const cur = first ? sectionLayers(first)[uTab] : undefined;
                      if (!cur?.quote) return null;
                      const q = cur.quote;
                      const mat = q.pieceMode
                        ? (q.pieces ?? 0) * (q.costPerPiece ?? 0)
                        : (q.lumpSum ?? 0);
                      return (
                        <p className="basis-full">
                          Layer {uTab + 1} quote “{q.name}”: {money(mat)} + {q.laborAmount ?? 0}
                          {q.laborInDays ? " days" : " h"} labor{" "}
                          <button
                            type="button"
                            className="font-medium text-primary underline underline-offset-2"
                            disabled={uSel.length === 0}
                            onClick={() => openQuoteDialog(cur.board)}
                          >
                            Edit quote
                          </button>
                        </p>
                      );
                    })()}
                    <p>
                      Underlayment price per sq ft:{" "}
                      <span className="font-semibold tabular-nums">
                        {(admin.underlaymentPrices?.[uBoard] ?? 0).toFixed(2)}
                      </span>
                      {(underlaymentPriceOverrides[uBoard] ?? 0) > 0 && (
                        <span className="ml-1 text-amber-700">
                          (this bid: {underlaymentPriceOverrides[uBoard]!.toFixed(2)})
                        </span>
                      )}
                    </p>
                    {uBoard && (
                      <Field label="Bid $/sq ft (0 = admin price)">
                        <NumInput
                          min={0}
                          value={underlaymentPriceOverrides[uBoard] ?? 0}
                          onValue={(v) =>
                            setUnderlaymentPriceOverrides((prev) => {
                              const next = { ...prev };
                              if (v > 0) next[uBoard] = v;
                              else delete next[uBoard];
                              return next;
                            })
                          }
                        />
                      </Field>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Field label="Select Attachment Method">
                      {(() => {
                        // Legacy LoadAttachment: a Duro-Bond section forces (and greys out) the
                        // Duro-Bond option; other systems pick from the ordinary list.
                        const picked = sections.filter((x) => uSel.includes(x.id));
                        const dbSel =
                          picked.length > 0
                            ? picked.some((x) => (x.roofSystem ?? roofSystem) === "Duro-Bond")
                            : roofSystem === "Duro-Bond";
                        const opts = uAttachOptions(dbSel, picked.length > 1);
                        return (
                          <PickOne
                            value={dbSel ? opts[0]! : U_ATTACH_LABEL[uAttach]}
                            options={opts}
                            disabled={dbSel}
                            onChange={(v) => setUAttach(uAttachFromLabel(v))}
                          />
                        );
                      })()}
                    </Field>
                    {uAttachEffective === "durobond" && (
                      <p className="col-span-2 self-end pb-2 text-[11px] text-muted-foreground">
                        Layout labor only — the board is held by the membrane&apos;s induction
                        plates, which are counted in the Duro-Bond section labor and the Fasteners
                        screens.
                      </p>
                    )}
                    {uAttachEffective === "mechanical" && (
                      <p className="col-span-2 self-end pb-2 text-[11px] text-muted-foreground">
                        Fasteners follow the legacy rule: 5 per 4×8 board (4 per 4×4), 10 / 16 per
                        board field / perimeter when the membrane is adhered, 0.08 per sq ft for
                        slip sheets — override in Enhancement Options.
                      </p>
                    )}
                    {uAttachEffective === "none" && (
                      <p className="col-span-2 self-end pb-2 text-[11px] text-muted-foreground">
                        Layout labor only — no fasteners or adhesive.
                      </p>
                    )}
                    {uAttachEffective === "adhesive" && (
                      <>
                        <Field label="Adhesive">
                          <PickOne value={uAdh} options={adhesiveOptions} onChange={setUAdh} />
                        </Field>
                        <Field label="Attached To (derived)">
                          <p className="pt-2 text-xs">
                            {(() => {
                              const sec = sections.find((x) => uSel.includes(x.id));
                              if (!sec) return "select a section";
                              const d = deriveAdhesiveSubstrate(
                                admin,
                                sec.deckType,
                                sectionLayers(sec),
                                uTab,
                              );
                              const ok =
                                d.substrate !== undefined &&
                                !!admin.adhesiveTimes?.bySubstrate[uAdh]?.[d.substrate];
                              return d.substrate
                                ? `${d.substrate} (${d.source === "deck" ? "deck" : "layer below"})${ok ? "" : " — no coverage row for this adhesive"}`
                                : "not derivable for this deck / board";
                            })()}
                          </p>
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
                            // Duro-Bond sections always store the forced legacy option (§22.28).
                            const att: UAttach =
                              (s.roofSystem ?? roofSystem) === "Duro-Bond" ? "durobond" : uAttach;
                            nextLayers[idx] = {
                              board: uBoard,
                              attachment: att,
                              fastenersPerBoard: 0,
                              adhesiveName: att === "adhesive" ? uAdh : "",
                              // The engine derives the substrate (deck / layer below, legacy).
                              substrate: "",
                              // §10.7: containers billed verbatim when this layer sits over a
                              // tapered/crickets-group board (engine checks the group).
                              ...(att === "adhesive" && uQAU > 0
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
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Adhesive ribbon spacing — field (in; 0 = default)">
                            <NumInput min={0} value={uEnhSpacing} onValue={setUEnhSpacing} />
                          </Field>
                          <Field label="Perimeter / corner (in; 0 = same as field)">
                            <NumInput
                              min={0}
                              value={uEnhSpacingPerim}
                              onValue={setUEnhSpacingPerim}
                            />
                          </Field>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Adhesive units per zone are multiplied by the whole number 12 ÷ spacing
                          (legacy rounds it to an integer: 8&quot; → ×2, 9&quot; → ×1, 24&quot; →
                          ×0); fastener counts become Round(density × zone area) per zone.
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
                                  if (uEnhSpacing > 0 && uEnhSpacingPerim > 0)
                                    nx.uAdhesiveSpacingPerimIn = uEnhSpacingPerim;
                                  else delete nx.uAdhesiveSpacingPerimIn;
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
                                  delete nx.uAdhesiveSpacingPerimIn;
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
                        const hours = qLaborDays ? qLabor * effectiveHoursPerDay : qLabor;
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
                              /* Legacy: the price link re-opens the quote pre-filled (HandleGetQuote
                                 edit path); frmQuoteDecision (§10.7) merge sums LumpSum + labor. */
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                                <span>
                                  Quote “{existingQuoteFor(uQuoteBoard)!.name}” is on this layer:
                                </span>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="radio"
                                    checked={qMode === "edit"}
                                    onChange={() => {
                                      const ex = existingQuoteFor(uQuoteBoard);
                                      fillQuoteForm(ex, ex?.name ?? "New Quote");
                                      setQMode("edit");
                                    }}
                                  />
                                  Edit it
                                </label>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="radio"
                                    checked={qMode === "merge"}
                                    onChange={() => {
                                      fillQuoteForm(undefined, existingQuoteFor(uQuoteBoard)!.name);
                                      setQMode("merge");
                                    }}
                                  />
                                  Add these amounts to it
                                </label>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="radio"
                                    checked={qMode === "new"}
                                    onChange={() => {
                                      fillQuoteForm(undefined, "New Quote");
                                      setQMode("new");
                                    }}
                                  />
                                  Start a new quote
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
                                        .map((x) => ({ lengthFt: x.length, widthFt: x.width })),
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
                                  {/* Legacy frmULQuote keeps ONE LumpSum: typing a per-piece cost
                                      writes pieces × cost into it (shown greyed in piece mode);
                                      typing a lump sum writes Round(lump / pieces, 4) back. */}
                                  <NumInput
                                    min={0}
                                    value={qPieceMode ? qPieces * qCpp : qLump}
                                    disabled={qPieceMode}
                                    onValue={(v) => {
                                      setQLump(v);
                                      if (qPieces > 0)
                                        setQCpp(Math.round((v / qPieces) * 10000) / 10000);
                                    }}
                                  />
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
                                    <NumInput
                                      min={0}
                                      value={qPieces}
                                      onValue={(v) => {
                                        setQPieces(v);
                                        setQLump(v * qCpp);
                                      }}
                                    />
                                  </Field>
                                  <Field label="Cost per piece ($)">
                                    <NumInput
                                      min={0}
                                      value={qCpp}
                                      onValue={(v) => {
                                        setQCpp(v);
                                        setQLump(qPieces * v);
                                      }}
                                    />
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
                            const hpd = effectiveHoursPerDay;
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
                              existing && qMode === "merge"
                                ? {
                                    id: existing.id ?? crypto.randomUUID(),
                                    name: existing.name,
                                    lumpSum: lumpOf(existing) + lumpOf(entered),
                                    laborAmount: norm(existing) + norm(entered),
                                  }
                                : existing && qMode === "edit"
                                  ? { ...entered, id: existing.id ?? crypto.randomUUID() }
                                  : { id: crypto.randomUUID(), ...entered };
                            // Editing / merging rewrites EVERY layer carrying the quote id (legacy
                            // CustomQuotes holds one shared object), plus the selection's layer —
                            // which keeps its attachment / quote containers when it already had
                            // this entry.
                            const sharedId = qMode !== "new" ? existing?.id : undefined;
                            setSections((prev) =>
                              prev.map((s) => {
                                const nextLayers = [...sectionLayers(s)];
                                let changed = false;
                                if (sharedId) {
                                  nextLayers.forEach((l, i) => {
                                    if (l.quote?.id === sharedId) {
                                      nextLayers[i] = { ...l, quote };
                                      changed = true;
                                    }
                                  });
                                }
                                if (uSel.includes(s.id)) {
                                  const idx = Math.min(uTab, nextLayers.length);
                                  const cur = nextLayers[idx];
                                  nextLayers[idx] =
                                    cur && cur.board === board
                                      ? { ...cur, quote }
                                      : {
                                          board,
                                          attachment: "mechanical",
                                          fastenersPerBoard: 0,
                                          adhesiveName: "",
                                          substrate: "",
                                          quote,
                                        };
                                  changed = true;
                                }
                                return changed
                                  ? { ...s, layers: nextLayers, underlaymentBoard: "" }
                                  : s;
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

        {/* Legacy Parapets screen (frmParapets): deck / wall type / length / pieces, the
            Skirt-Cant-Vertical-Top-Drop profile, termination / capstone / ARP tabs, Membrane
            Options (per-wall Roof System / Attachment / adhesive / mil / color), the frmLaborPopUp
            labor link, Fasteners Needed and lvSummary — docs §19. */}
        <div className={step === 3 ? "space-y-6" : "hidden"} {...ro}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Parapets</CardTitle>
            </CardHeader>
            <CardContent>
              <ParapetsScreen
                parapets={parapets}
                onChange={setParapets}
                selected={selParapet}
                onSelect={setSelParapet}
                admin={admin}
                bidDefaults={{ roofSystem, attachment, membraneAdhesiveName: membraneAdhesive }}
                sections={sections}
                colorOptions={colorOptions}
                crewRate={laborRate}
                hoursById={result?.parapetHoursById ?? {}}
                baseHoursById={result?.parapetBaseHoursById ?? {}}
                {...(result?.accessories
                  ? { fastenersNeeded: result.accessories.parapetTabs.fastenersNeeded }
                  : {})}
                templateAdjustPct={templateDeltas.roofSection}
                newParapet={() =>
                  newParapet({
                    // Legacy Parapet ctor: a new wall seeds AdjustLabor from Template.ParapetsLabor.
                    adjustLaborPct: seedParapetAdjust(templateDeltas),
                    // Setup "1. Deck Type" / "2. Wall Type" seed every new wall.
                    deckType: sectionDefaults.deckType,
                    wallType: parapetDefaults.wallType ?? 4,
                    ...(parapetDefaults.roofSystem
                      ? { roofSystem: parapetDefaults.roofSystem }
                      : {}),
                    ...(parapetDefaults.attachment
                      ? { attachment: parapetDefaults.attachment }
                      : {}),
                    ...(parapetDefaults.membraneAdhesiveName
                      ? { membraneAdhesiveName: parapetDefaults.membraneAdhesiveName }
                      : {}),
                    ...(parapetDefaults.thicknessMil !== undefined
                      ? { thicknessMil: parapetDefaults.thicknessMil }
                      : {}),
                    ...(parapetDefaults.color ? { color: parapetDefaults.color } : {}),
                  })
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* Legacy Curbs screen (frmCurbs): style toolstrip, dims, termination, insulation /
            plastic, the picCurb drawing with the A/B/C/D readout and the lvSummary — docs
            §8.1–§8.3. Wrap material via curb-wrap.ts (§2); labor per §8.2 BaseHours. */}
        <div className={step === 4 ? "space-y-6" : "hidden"} {...ro}>
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
                newCurb={() => newCurb({ adjustLaborPct: seedCurbAdjust(templateDeltas) })}
              />
            </CardContent>
          </Card>
        </div>

        <div className={step === 5 ? "space-y-6" : "hidden"} {...ro}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Accessories</CardTitle>
              {result?.accessories && (
                <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                  <span>
                    Material Cost:{" "}
                    <span className="font-semibold">
                      {money(
                        result.accessories.totalCost + accessoryTotal + result.adhesiveMaterial,
                      )}
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
                sections={sections.map((s) => ({
                  id: s.id,
                  name: s.name,
                  color: s.color,
                  roofSystem: s.roofSystem ?? roofSystem,
                }))}
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
                            <NumberField
                              step="0.0001"
                              className="h-8 w-[80px]"
                              value={a.laborHoursPerUnit ?? 0}
                              onChange={(v) =>
                                setAccessories((p) =>
                                  p.map((x, j) => (j === i ? { ...x, laborHoursPerUnit: v } : x)),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <NumberField
                              className="h-8 w-[70px]"
                              value={a.quantity}
                              onChange={(v) =>
                                setAccessories((p) =>
                                  p.map((x, j) => (j === i ? { ...x, quantity: v } : x)),
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
        <div className={step === 6 ? "space-y-6" : "hidden"} {...ro}>
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
                          <NumberField
                            className="h-8 w-[70px]"
                            value={m.quantity}
                            onChange={(v) =>
                              setMetals((p) =>
                                p.map((x, j) => (j === i ? { ...x, quantity: v } : x)),
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
        <div className={step === 7 ? "space-y-6" : "hidden"} {...ro}>
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
              <LaborAdjustDialog
                open={toLaborOpen}
                onOpenChange={setToLaborOpen}
                title="Tear-off Labor Adjustment"
                scope={`${sections.filter((x) => toSel.includes(x.id)).length} selected section(s)`}
                note="Legacy keeps this as a whole percent."
                baseHours={toLabor.base}
                differing={toLabor.differing}
                pct={toLaborPct}
                onPct={setToLaborPct}
                integerPct
                templateDefault={{
                  pct: templateDeltas.tearOff,
                  onUse: () => {
                    setSections((prev) =>
                      prev.map((x) =>
                        toSel.includes(x.id)
                          ? { ...x, tearOffAdditionalPct: Math.round(templateDeltas.tearOff) }
                          : x,
                      ),
                    );
                    setToLaborOpen(false);
                  },
                }}
                onFinish={() => {
                  setSections((prev) =>
                    prev.map((x) =>
                      toSel.includes(x.id)
                        ? { ...x, tearOffAdditionalPct: Math.round(toLaborPct) }
                        : x,
                    ),
                  );
                  setToLaborOpen(false);
                }}
              />
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
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
                              // Same as Underlayment: a row click moves the selection to this
                              // section; the tick box adds/removes it for a multi-section apply.
                              onClick={() => setToSel([s.id])}
                              className={sel ? "cursor-pointer bg-primary/15" : "cursor-pointer"}
                            >
                              <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 align-middle"
                                  checked={sel}
                                  aria-label={`Select ${s.name}`}
                                  onChange={() =>
                                    setToSel((prev) =>
                                      prev.includes(s.id)
                                        ? prev.filter((x) => x !== s.id)
                                        : [...prev, s.id],
                                    )
                                  }
                                />
                              </TableCell>
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
                      <button
                        type="button"
                        className="pb-2 text-xs font-medium text-primary underline underline-offset-2 disabled:opacity-50"
                        disabled={toSel.length === 0}
                        title="Tear-off hours of the selected sections after their adjustment (100% = as calculated). Click to change the hours or the percent."
                        onClick={() => {
                          const first = sections.find((x) => toSel.includes(x.id));
                          setToLaborPct(first?.tearOffAdditionalPct ?? 0);
                          setToLaborOpen(true);
                        }}
                      >
                        Labor: <span className="tabular-nums">{toLabor.adjusted.toFixed(2)} h</span>
                        {toLabor.suffix}
                      </button>
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
                          <TableHead>Section</TableHead>
                          <TableHead>W x L</TableHead>
                          <TableHead>Core Cut</TableHead>
                          <TableHead className="text-right">Thickness</TableHead>
                          <TableHead className="text-right">Labor (h)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sections.map((s) => (
                          // Legacy lvSummary: clicking a row selects that section (its labor
                          // shows on the Labor link and can be adjusted there).
                          <TableRow
                            key={s.id}
                            onClick={() => setToSel([s.id])}
                            className={
                              toSel.includes(s.id)
                                ? "cursor-pointer bg-primary/15"
                                : "cursor-pointer"
                            }
                          >
                            <TableCell className="font-medium">{s.name}</TableCell>
                            <TableCell className="tabular-nums">
                              {s.width}x{s.length}
                            </TableCell>
                            <TableCell className="text-xs">
                              {s.tearOff ? s.tearOffType || "(no type)" : "Unknown"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(s.tearOff ? s.toThicknessInches : 0).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(toLabor.byId[s.id]?.adjusted ?? 0).toFixed(2)}
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
        <div className={step === 8 ? "space-y-6" : "hidden"} {...ro}>
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
                          <NumberField
                            className="h-8 w-[70px]"
                            value={l.quantity}
                            onChange={(v) =>
                              setNonDlLines((p) =>
                                p.map((x, j) => (j === i ? { ...x, quantity: v } : x)),
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

        <div className={step === 9 && showPricingSettings ? "space-y-6" : "hidden"} {...ro}>
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
                <NumberField value={markup} onChange={(v) => setMarkup(v)} />
              </Field>
              <Field label="Labor $/hr">
                <NumberField value={laborRate} onChange={(v) => setLaborRate(v)} />
              </Field>
              <Field label="Commission %">
                <NumberField value={commission} onChange={(v) => setCommission(v)} />
              </Field>
              <Field label="Adjust labor %">
                <NumberField
                  min={-100}
                  value={adjustLaborPct}
                  onChange={(v) => setAdjustLaborPct(v)}
                />
              </Field>
              <Field label="Adjust setup %">
                <NumberField
                  min={-100}
                  value={adjustSetupPct}
                  onChange={(v) => setAdjustSetupPct(v)}
                />
              </Field>
              <Field label="Adjust inspection %">
                <NumberField
                  min={-100}
                  value={adjustInspectionPct}
                  onChange={(v) => setAdjustInspectionPct(v)}
                />
              </Field>
              <Field label="Labor template">
                <PickOne
                  value={laborTemplateName || "None"}
                  options={laborTemplateOptions}
                  onChange={(v) => {
                    if (
                      bidId &&
                      laborTemplateName !== (v === "None" ? "" : v) &&
                      !window.confirm(
                        "Are you sure you want to change your labor template? This will override all manually entered labor settings.",
                      )
                    )
                      return;
                    applyTemplate(v === "None" ? "" : v);
                  }}
                />
              </Field>
              <Field label="Per-diem $/man-day">
                <NumberField value={perDiem} onChange={(v) => setPerDiem(v)} />
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

        <div className={step === 9 ? "space-y-6" : "hidden"} {...ro}>
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
                {customer.perDiemChart && (
                  /* The Setup step's per-diem chart (§22.49) — informational, not in the ledger. */
                  <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
                    <PerDiemChartView chart={normalizePerDiemChart(customer.perDiemChart)} />
                  </div>
                )}
                <EstimateReviewLedger
                  ledger={result.ledger}
                  est={result.r}
                  stats={{
                    roofSqFt: result.r.roofSqFootage,
                    // Legacy dTotals[29]: membrane + parapet adjusted sqft + ARP (both sides).
                    membraneSqFt:
                      result.r.sqFtTotalMembrane +
                      result.reviewMembraneSqFtExtras.parapetAdjustedSqFt +
                      result.reviewMembraneSqFtExtras.parapetArpSqFt +
                      result.reviewMembraneSqFtExtras.sectionArpSqFt,
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
          {result && (
            <Collapsible open={orderOpen} onOpenChange={setOrderOpen} asChild>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left"
                        title={orderOpen ? "Collapse" : "Expand"}
                      >
                        <ChevronRight
                          className={`h-4 w-4 transition-transform ${orderOpen ? "rotate-90" : ""}`}
                        />
                        <CardTitle className="text-base">Order list</CardTitle>
                        {priceTargets && (
                          <span className="text-xs font-normal text-muted-foreground">
                            {orderList.length} product{orderList.length === 1 ? "" : "s"} ·{" "}
                            {toBuyCount(orderList)} to buy
                          </span>
                        )}
                      </button>
                    </CollapsibleTrigger>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={orderList.length === 0}
                        onClick={printOrderList}
                        title="Opens a print view — choose Save as PDF in the print dialog"
                      >
                        Print / PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={orderList.length === 0}
                        onClick={exportOrderExcel}
                      >
                        Excel
                      </Button>
                    </div>
                  </div>
                  <CollapsibleContent>
                    <CardDescription>
                      What this bid needs to buy, from the same lines it bills. Where Inventory has
                      the product on hand, &quot;Use from inventory&quot; takes it off the shelf for
                      this job (written to the Inventory ledger) and &quot;To buy&quot; drops by
                      that much; the price never changes.
                      {bidId ? (
                        <>
                          {" "}
                          <Link
                            to="/inventory"
                            search={{ bid: bidId }}
                            className="underline underline-offset-2"
                          >
                            Record leftovers for this bid
                          </Link>
                        </>
                      ) : (
                        " Save the bid to pull from stock."
                      )}
                    </CardDescription>
                  </CollapsibleContent>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="space-y-2 text-sm">
                    {!priceTargets ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : orderList.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nothing to order yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Product</TableHead>
                              <TableHead className="text-right">Needed</TableHead>
                              <TableHead
                                className="text-right"
                                title="Taken from inventory for this bid — already subtracted from To buy"
                              >
                                From inventory
                              </TableHead>
                              <TableHead className="text-right">On hand</TableHead>
                              <TableHead className="text-right">To buy</TableHead>
                              <TableHead className="w-[250px]">Use inventory</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(
                              [
                                "Membrane",
                                "Underlayment",
                                "Fasteners",
                                "Adhesives",
                                "Accessories",
                              ] as const
                            )
                              .filter((g) => orderList.some((l) => l.group === g))
                              .map((g) => (
                                <Fragment key={g}>
                                  <TableRow className="bg-muted/40">
                                    <TableCell colSpan={6} className="py-1 text-xs font-semibold">
                                      {g}
                                    </TableCell>
                                  </TableRow>
                                  {orderList
                                    .filter((l) => l.group === g)
                                    .map((l, idx) => (
                                      <TableRow key={`${g}-${idx}`}>
                                        <TableCell className="text-xs">
                                          {l.name}
                                          {!l.cell && (
                                            <span
                                              className="ml-1 text-[10px] text-muted-foreground"
                                              title="No catalog product matched this line, so stock cannot be applied"
                                            >
                                              (no stock match)
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">
                                          {describeOrderQty(l, l.needed)}
                                          {l.pieces !== undefined && (
                                            <span className="ml-1 text-[10px] text-muted-foreground">
                                              ({l.pieces.toLocaleString()} pcs)
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">
                                          {l.pulled > 0 ? describeOrderQty(l, l.pulled) : "—"}
                                        </TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">
                                          {l.stockUnit ? (
                                            <span
                                              className="text-muted-foreground"
                                              title={`Inventory counts this product in ${l.stockUnit}, the bid needs ${l.unit} — not netted`}
                                            >
                                              shelf in {l.stockUnit}
                                            </span>
                                          ) : l.onHand !== undefined ? (
                                            describeOrderQty(l, l.onHand)
                                          ) : (
                                            "—"
                                          )}
                                        </TableCell>
                                        <TableCell
                                          className={`text-right text-xs font-semibold tabular-nums ${l.toBuy === 0 ? "text-green-700 dark:text-green-400" : ""}`}
                                        >
                                          {describeOrderQty(l, l.toBuy)}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                          {l.cell && (l.pullable > 0 || l.pulled > 0) && (
                                            <div className="flex items-center gap-1">
                                              {l.pullable > 0 && (
                                                <>
                                                  <Input
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="any"
                                                    min={0}
                                                    max={l.pullable}
                                                    className="h-7 w-20 text-xs"
                                                    placeholder={String(
                                                      Math.round(l.pullable * 1000) / 1000,
                                                    )}
                                                    value={pullQty[pullKey(l)] ?? ""}
                                                    onChange={(e) =>
                                                      setPullQty((p) => ({
                                                        ...p,
                                                        [pullKey(l)]: e.target.value,
                                                      }))
                                                    }
                                                    disabled={!bidId || readOnly}
                                                    title={
                                                      bidId
                                                        ? `How much of the ${describeOrderQty(l, l.onHand ?? 0)} in inventory to use on this job (up to ${describeOrderQty(l, l.pullable)})`
                                                        : "Save the bid first"
                                                    }
                                                  />
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 px-2 text-xs"
                                                    disabled={
                                                      !bidId || readOnly || pulling === pullKey(l)
                                                    }
                                                    onClick={() => {
                                                      const raw = pullQty[pullKey(l)];
                                                      const n =
                                                        raw && raw.trim() !== ""
                                                          ? Number(raw)
                                                          : l.pullable;
                                                      if (!Number.isFinite(n) || n <= 0) return;
                                                      void recordPull(
                                                        l,
                                                        "consumed",
                                                        Math.min(n, l.pullable),
                                                      );
                                                    }}
                                                  >
                                                    Use from inventory
                                                  </Button>
                                                </>
                                              )}
                                              {l.pulled > 0 && (
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  className="h-7 px-2 text-xs"
                                                  disabled={
                                                    !bidId || readOnly || pulling === pullKey(l)
                                                  }
                                                  title="Put everything this bid took from inventory back on the shelf"
                                                  onClick={() =>
                                                    void recordPull(l, "released", l.pulled)
                                                  }
                                                >
                                                  Put back
                                                </Button>
                                              )}
                                            </div>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </Fragment>
                              ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <Button
            variant="outline"
            disabled={step === 0 || saving}
            title={readOnly ? "Goes back (read only)" : "Saves the bid, then goes back"}
            onClick={() => (readOnly ? goStep(step - 1) : saveAndGo(step - 1))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />{" "}
            {saving ? "Saving…" : readOnly ? "Previous" : "Save & Previous"}
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Step {step + 1} of {STEPS.length} — {STEPS[step]!.label}
            {dirty && (
              <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">
                · Unsaved changes
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {STEPS[step]?.key === "review" && (
              <Button
                variant="outline"
                disabled={!result}
                title="Download the estimate review as CSV"
                onClick={exportReview}
              >
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            )}
            {step < STEPS.length - 1 && (
              <Button
                onClick={() => (readOnly ? goStep(step + 1) : saveAndGo(step + 1))}
                disabled={saving}
                title={readOnly ? "Moves on (read only)" : "Saves the bid, then moves on"}
              >
                {saving ? "Saving…" : readOnly ? "Next" : "Save & Next"}{" "}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <UpdateBidDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        pricingStale={pricingStale}
        frozenAsOf={frozenAsOf}
        underlaymentQuoteCount={
          Object.values(underlaymentPriceOverrides).filter((v) => v > 0).length
        }
        ndlOverrides={countNonDlOverrides(nonDlCalc)}
        laborTemplateName={laborTemplateName}
        formulasVersion={formulasVersion}
        latestFormulasVersion={CURRENT_FORMULAS_VERSION}
        onApply={applyUpdateOptions}
      />
      <div id="bid-total-panel" className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs">Status</Label>
            <Select
              value={bidStatus}
              onValueChange={(v) => setBidStatus(v as BidStatus)}
              disabled={readOnly}
            >
              <SelectTrigger className="h-9">
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
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={!result}
            title="Download the estimate review (cost, labor and unit metrics) as CSV"
            onClick={exportReview}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Bid total</CardTitle>
              {!bidTotalOpen && result && (
                <p className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
                  {money(result.r.money.grandTotal)}
                  {result.warnings.length > 0 && (
                    <AlertTriangle
                      className="h-4 w-4 text-amber-500"
                      aria-label={`${result.warnings.length} input warning(s)`}
                    />
                  )}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2"
              onClick={toggleBidTotal}
              aria-expanded={bidTotalOpen}
              aria-controls="bid-total-body"
            >
              {bidTotalOpen ? (
                <>
                  <ChevronUp className="mr-1 h-4 w-4" /> Minimize
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-4 w-4" /> Details
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent id="bid-total-body" className={bidTotalOpen ? "space-y-3" : "hidden"}>
            {frozenAsOf !== null && pricingStale && (
              <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-xs">
                Priced with management data frozen{" "}
                {frozenAsOf ? `on ${new Date(frozenAsOf).toLocaleDateString()}` : "at save"} —
                pricing or labor has changed since. Use &quot;Update pricing &amp; labor&quot;
                above.
              </div>
            )}
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
                  {/* Duro-Last material (dTotals[0]) less every other Duro-Last bucket shown on
                      its own row below — the calculated accessory screens' material (edge terms,
                      flashing, fasteners, ARP) is Accessories, not membrane. */}
                  <Row
                    label="Membrane material"
                    v={money(
                      (result.r.money.dTotals[0] ?? 0) -
                        accessoryTotal -
                        (result.accessories?.totalCost ?? 0) -
                        result.arpMaterial -
                        result.parapetMaterial -
                        result.curbMaterial -
                        result.metalsMaterial -
                        result.adhesiveMaterial -
                        result.slipSheetMaterial,
                    )}
                  />
                  {result.slipSheetMaterial > 0 && (
                    <Row
                      label="Slip sheets (Duro-Last material)"
                      v={money(result.slipSheetMaterial)}
                    />
                  )}
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
                  {accessoryTotal + (result.accessories?.totalCost ?? 0) + result.arpMaterial >
                    0 && (
                    <Row
                      label="Accessories"
                      v={money(
                        accessoryTotal + (result.accessories?.totalCost ?? 0) + result.arpMaterial,
                      )}
                    />
                  )}
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
        <AccessorySummaryCard
          result={result?.accessories}
          extraLines={result?.adhesiveLines}
          laborRate={laborRate}
        />
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
            onClick={() => {
              if (!bidTotalOpen) toggleBidTotal();
              document.getElementById("bid-total-panel")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Details
          </Button>
        </div>
      )}
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
  disabled,
}: {
  value: number;
  onValue: (n: number) => void;
  min?: number;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <NumberField
      value={value}
      onChange={onValue}
      min={min ?? 0}
      step="any"
      className={className}
      disabled={disabled}
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
