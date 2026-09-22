/**
 * Bid Combiner — the legacy `BidAdvantage.BidCombiner` (Estimator.exe) ported as a pure merge.
 *
 * Legacy `CombineBids` (IL): the combined estimate is a NEW estimate (`MainStore.CreateNew` →
 * management defaults for every estimate-level value: "Base Labor and Item Costs have been set
 * according to management defaults"), then
 *   CombineQuotes      — every source's custom quotes are re-numbered and pooled;
 *   CombineRoofSections — every source section is appended (ParentEstimate re-pointed);
 *   ReduceQuotes       — layers keep pointing at their re-numbered quote;
 *   CombineCurbs / CombineParapets — every curb / parapet appended;
 *   CombineAccessories — user-entered QUANTITIES summed by item identity (AccOthers by
 *                        Description, Corners by RefID + colour, Washers / Strainers / Panduit /
 *                        Vents by part, Pipe Stacks by size + usage + open/closed, Drains by boot +
 *                        ring + roof type + reuse-ring, Term Bar / Fascia additional lengths and
 *                        cover quantities by colour, Generic edges' extra feet / corners / covers,
 *                        Sealants by description); strip-mastic flags OR-ed;
 *   CombineMetals      — Gutters / Downspouts by PartNumber (lengths summed, accessories' Qty
 *                        summed), Pitch Pans / Collection Boxes by RefID (Qty summed);
 *   Non-DL             — `frmNonDLReconcile`: items with the same Description are combined
 *                        (`CompareNDLItems` warns when Labor/Unit or Material Cost differ and asks
 *                        "OK to combine the quantities or Cancel to add as a separate entity");
 *   fasteners          — NOT carried: "Fasteners have been recalculated. You will need to enter
 *                        new quantities for the items highlighted in red on the Accessories page";
 *   Title "Combined Bid"; Description = the warning text + the list of source bids.
 *
 * Everything the engine DERIVES per job (setup / inspection hours, shipping, per diem, warranty,
 * markup, commission, the fastener / plate / adhesive calc quantities, membrane) is therefore
 * computed ONCE from the merged inputs — nothing "1 per job" is summed. Web departures are listed
 * in docs §22.41.
 */
import type { AccessoriesState } from "@/lib/engine/accessories";
import { emptyAccessoriesState, normalizeAccessoriesState } from "@/lib/engine/accessories";
import type {
  AccessoryLine,
  BidSectionInput,
  CurbInput,
  NonDlLine,
  ParapetInput,
} from "@/lib/engine/bid-builder";
import { sectionLayers } from "@/lib/engine/bid-builder";
import type { MetalsState } from "@/lib/engine/metals";
import { emptyMetalsState, normalizeMetalsState } from "@/lib/engine/metals";
import type { NonDlGroup, NonDlState } from "@/lib/engine/nondl";
import { NON_DL_GROUPS, emptyNonDlState, normalizeNonDlState } from "@/lib/engine/nondl";
import type { SavedBidState } from "@/lib/proposal-bid";
import { emptyCustomer } from "@/lib/proposal-bid";

export interface CombineSource {
  id: string;
  name: string;
  saved: Partial<SavedBidState>;
}

/** Persisted on the combined bid (SavedBidState.combineInfo) — the legacy Description text's data. */
export interface CombineInfo {
  createdAt: string;
  sources: Array<{ id: string; name: string; client: string; estimator: string }>;
  /** Non-DL items combined although their unit cost / labor disagreed (legacy CompareNDLItems). */
  conflicts: string[];
}

export interface CombineResult {
  saved: SavedBidState;
  info: CombineInfo;
  /** Per source (by array index) old section id → new section id. */
  sectionIdMaps: Array<Record<string, string>>;
}

const sumInto = (
  target: Record<string, number>,
  add: Record<string, number> | undefined,
): Record<string, number> => {
  for (const [k, v] of Object.entries(add ?? {})) {
    if (typeof v !== "number" || !Number.isFinite(v) || v === 0) continue;
    target[k] = (target[k] ?? 0) + v;
  }
  return target;
};

const sumNested = (
  target: Record<string, Record<string, number>>,
  add: Record<string, Record<string, number>> | undefined,
) => {
  for (const [k, m] of Object.entries(add ?? {})) {
    target[k] = sumInto(target[k] ?? {}, m);
  }
  return target;
};

const num = (v: number | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Sum quantities of lines that are identical in every field but `quantity`. */
function mergeLines<T extends { quantity: number }>(lists: Array<T[] | undefined>): T[] {
  const out: T[] = [];
  const index = new Map<string, T>();
  for (const list of lists) {
    for (const line of list ?? []) {
      const { quantity: _q, ...rest } = line;
      const key = JSON.stringify(rest, Object.keys(rest).sort());
      const hit = index.get(key);
      if (hit) hit.quantity += line.quantity;
      else {
        const copy = { ...line };
        index.set(key, copy);
        out.push(copy);
      }
    }
  }
  return out;
}

function mergeAccessories(
  states: Array<{ st: AccessoriesState; sectionIds: Record<string, string> }>,
): AccessoriesState {
  const out = emptyAccessoriesState();
  for (const { st, sectionIds } of states) {
    // Term bar (legacy TermBars.ItemByColor AdditionalNoDrill/PreDrill summed, UseStripMastic OR-ed)
    sumInto(out.termBar.additionalNoDrill, st.termBar.additionalNoDrill);
    sumInto(out.termBar.additionalPreDrill, st.termBar.additionalPreDrill);
    if (st.termBar.additionalNoDrillOther)
      out.termBar.additionalNoDrillOther = sumInto(
        out.termBar.additionalNoDrillOther ?? {},
        st.termBar.additionalNoDrillOther,
      );
    if (st.termBar.additionalPreDrillOther)
      out.termBar.additionalPreDrillOther = sumInto(
        out.termBar.additionalPreDrillOther ?? {},
        st.termBar.additionalPreDrillOther,
      );
    out.termBar.stripMastic ||= st.termBar.stripMastic;
    if (num(st.termBar.stripMasticLengthFt) > 0)
      out.termBar.stripMasticLengthFt =
        num(out.termBar.stripMasticLengthFt) + num(st.termBar.stripMasticLengthFt);
    // Fascia 3" / 4" (legacy FaciaBars.Item1 / Item2: OtherNoDrill/PreDrill, StripMasticLength,
    // vinyl cover colours, metal cover length + inside/outside corners summed; flags OR-ed)
    for (const size of ["3", "4"] as const) {
      const a = out.fascia[size];
      const b = st.fascia[size];
      a.additionalNoDrillFt += num(b.additionalNoDrillFt);
      a.additionalPreDrillFt += num(b.additionalPreDrillFt);
      a.stripMastic ||= b.stripMastic;
      if (num(b.stripMasticLengthFt) > 0)
        a.stripMasticLengthFt = num(a.stripMasticLengthFt) + num(b.stripMasticLengthFt);
      a.vinylCovers.on ||= b.vinylCovers.on;
      sumInto(a.vinylCovers.qty, b.vinylCovers.qty);
      a.metalCovers.on ||= b.metalCovers.on;
      sumInto(a.metalCovers.qty, b.metalCovers.qty);
      a.metalCovers.inside += num(b.metalCovers.inside);
      a.metalCovers.outside += num(b.metalCovers.outside);
    }
    // Generic edges (legacy GenericEdge: ExtraByColor, Corners, Cover summed)
    for (const size of ["2", "4"] as const) {
      for (const screen of ["dripEdge", "gravelStop"] as const) {
        const a = out[screen][size];
        const b = st[screen][size];
        sumInto(a.extraFt, b.extraFt);
        sumInto(a.corners, b.corners);
        if (b.coverQty) a.coverQty = sumInto(a.coverQty ?? {}, b.coverQty);
        if (num(b.insideCorners) > 0) a.insideCorners = num(a.insideCorners) + num(b.insideCorners);
        if (num(b.outsideCorners) > 0)
          a.outsideCorners = num(a.outsideCorners) + num(b.outsideCorners);
      }
    }
    // Snap covers / two-piece metal (legacy TwoPieceMetal: OtherLength, CoversQuantity,
    // Inside/OutsideCornersQuantity summed)
    for (const size of Object.keys(out.snapCover) as Array<keyof typeof out.snapCover>) {
      const a = out.snapCover[size];
      const b = st.snapCover[size];
      if (!b) continue;
      a.additionalFt += num(b.additionalFt);
      a.coversOn ||= b.coversOn;
      if (num(b.coversQty) > 0) a.coversQty = num(a.coversQty) + num(b.coversQty);
      a.insideCorners += num(b.insideCorners);
      a.outsideCorners += num(b.outsideCorners);
    }
    // Corners by RefID + colour; washers / strainers / walk pads / panduit / sealants / vents /
    // adhesive extras by item
    sumNested(out.corners.qty, st.corners.qty);
    sumInto(out.washers.qty, st.washers.qty);
    sumInto(out.strainers.qty, st.strainers.qty);
    sumInto(out.walkPads.qty, st.walkPads.qty);
    sumInto(out.panduitExtra, st.panduitExtra);
    sumInto(out.sealants.extra, st.sealants.extra);
    out.sealants.showDiscontinued ||= st.sealants.showDiscontinued;
    sumInto(out.vents.delta, st.vents.delta);
    sumInto(out.adhesivesExtra, st.adhesivesExtra);
    // Pipe stacks: legacy keys Size + Usage + IsOpen (the web entry also carries a colour, kept
    // in the key so no colour is silently merged into another)
    for (const p of st.pipeStacks) {
      const hit = out.pipeStacks.find(
        (q) => q.size === p.size && q.usage === p.usage && q.open === p.open && q.color === p.color,
      );
      if (hit) hit.quantity += p.quantity;
      else out.pipeStacks.push({ ...p, id: `cb-ps-${out.pipeStacks.length + 1}`, adjustPct: 0 });
    }
    // Drains: legacy keys DrainBootSize + DrainRingSize + ExistingRoofType + ReuseRing
    for (const d of st.drains) {
      const hit = out.drains.find(
        (q) =>
          q.bootSize === d.bootSize &&
          q.ringSize === d.ringSize &&
          q.roofType === d.roofType &&
          q.reuseRings === d.reuseRings,
      );
      if (hit) hit.quantity += d.quantity;
      else out.drains.push({ ...d, id: `cb-dr-${out.drains.length + 1}`, adjustPct: 0 });
    }
    // Membrane accessories: extras summed; per-section stripping feet follow the section's new id
    out.membraneAccs.arpExtra += num(st.membraneAccs.arpExtra);
    out.membraneAccs.tPatchExtra += num(st.membraneAccs.tPatchExtra);
    for (const [sid, ft] of Object.entries(st.membraneAccs.strippingFtBySection)) {
      const nid = sectionIds[sid];
      if (nid && ft > 0) out.membraneAccs.strippingFtBySection[nid] = ft;
    }
    // fastenerQty: deliberately NOT carried — legacy recalculates the fasteners and asks the
    // estimator to re-enter the red items. Adjust % fields stay at the fresh defaults (0).
  }
  return out;
}

function mergeMetals(states: MetalsState[]): MetalsState {
  const out = emptyMetalsState();
  for (const st of states) {
    for (const g of st.gutters) {
      const hit = out.gutters.find((x) => x.style === g.style && x.size === g.size);
      if (hit) {
        hit.lengthFt += num(g.lengthFt);
        sumInto(hit.accQty, g.accQty);
      } else out.gutters.push({ ...g, accQty: { ...g.accQty } });
    }
    for (const d of st.downspouts) {
      const hit = out.downspouts.find((x) => x.size === d.size);
      if (hit) {
        sumInto(hit.lengthByDesc, d.lengthByDesc);
        sumInto(hit.accQty, d.accQty);
      } else
        out.downspouts.push({ ...d, lengthByDesc: { ...d.lengthByDesc }, accQty: { ...d.accQty } });
    }
    sumInto(out.generalAccQty, st.generalAccQty);
    sumInto(out.pitchPanQty, st.pitchPanQty);
    sumNested(out.collectionBoxQty, st.collectionBoxQty);
  }
  return out;
}

const OVERRIDE_KEYS = ["unitCost", "laborPerUnit", "laborRate", "laborHours"] as const;

function mergeNonDl(states: NonDlState[], conflicts: string[]): NonDlState {
  const out = emptyNonDlState();
  for (const st of states) {
    for (const group of NON_DL_GROUPS as NonDlGroup[]) {
      const rows = st.rows[group];
      if (rows) {
        const target = (out.rows[group] ??= {});
        for (const [desc, r] of Object.entries(rows)) {
          const cur = target[desc];
          if (!cur) {
            target[desc] = { ...r };
            continue;
          }
          // Legacy CompareNDLItems: same Description → combine the quantities; differing
          // Labor/Unit or Material Cost is reported (the dialog's OK path keeps the first).
          cur.extra += num(r.extra);
          for (const k of OVERRIDE_KEYS) {
            const a = cur[k];
            const b = r[k];
            if (b === undefined) continue;
            if (a === undefined) cur[k] = b;
            else if (a !== b)
              conflicts.push(
                `${desc}: ${OVERRIDE_LABEL[k]} ${b} vs ${a} — kept ${a}, quantities combined`,
              );
          }
        }
      }
      const custom = st.custom[group];
      if (custom?.length) {
        const target = (out.custom[group] ??= []);
        for (const c of custom) {
          const hit = target.find(
            (x) =>
              x.description === c.description &&
              x.unitCost === c.unitCost &&
              x.laborPerUnit === c.laborPerUnit &&
              x.laborRate === c.laborRate,
          );
          if (hit) {
            hit.qty += num(c.qty);
            if (c.laborHours !== undefined)
              hit.laborHours = num(hit.laborHours) + num(c.laborHours);
          } else {
            const same = target.find((x) => x.description === c.description);
            if (same)
              conflicts.push(
                `${c.description}: custom item priced ${c.unitCost} / ${c.laborPerUnit} h vs ${same.unitCost} / ${same.laborPerUnit} h — added as a separate line`,
              );
            target.push({ ...c });
          }
        }
      }
    }
  }
  return out;
}

const OVERRIDE_LABEL: Record<(typeof OVERRIDE_KEYS)[number], string> = {
  unitCost: "unit cost",
  laborPerUnit: "labor/unit",
  laborRate: "labor rate",
  laborHours: "labor hours",
};

/**
 * Combine two or more saved bids into ONE new (unsaved) bid.
 *
 * `fresh` is what a brand-new bid looks like right now (the estimator's defaults) — the legacy
 * "management defaults" every estimate-level value comes from. The only estimate-level values
 * taken from a source are the FIRST bid's roof system / attachment / membrane adhesive: web
 * sections inherit those from the bid, so a section whose source bid used a different system is
 * stamped with its own (legacy sections always carried their own RoofSystem).
 */
export function combineSavedBids(
  sources: CombineSource[],
  fresh: SavedBidState,
  now: string = new Date().toISOString(),
): CombineResult {
  if (sources.length < 2) throw new Error("Select two or more bids to combine.");
  const first = sources[0]!.saved;
  const roofSystem = first.roofSystem ?? fresh.roofSystem;
  const attachment = first.attachment ?? fresh.attachment;
  const membraneAdhesiveName = first.membraneAdhesiveName ?? fresh.membraneAdhesiveName;

  const sections: BidSectionInput[] = [];
  const parapets: ParapetInput[] = [];
  const curbs: CurbInput[] = [];
  const sectionIdMaps: Array<Record<string, string>> = [];
  const conflicts: string[] = [];
  let quoteSeq = 0;

  sources.forEach((src, si) => {
    const s = src.saved;
    const prefix = `${si + 1}.`;
    const idMap: Record<string, string> = {};
    const quoteIds = new Map<string, string>();
    const srcSystem = s.roofSystem ?? fresh.roofSystem;
    const srcAttach = s.attachment ?? fresh.attachment;
    const srcAdhesive = s.membraneAdhesiveName ?? fresh.membraneAdhesiveName;
    for (const sec of s.sections ?? []) {
      const id = prefix + sec.id;
      idMap[sec.id] = id;
      // CombineQuotes / ReduceQuotes: a quote id is unique WITHIN its source bid; re-key per
      // source so a quote shared by two sections of one bid still bills once, while two bids'
      // quotes (e.g. copies of one bid) never collapse into each other.
      const layers = sectionLayers(sec).map((l) => {
        if (!l.quote) return l;
        const oldId = l.quote.id ?? `anon-${quoteSeq++}`;
        let nid = quoteIds.get(oldId);
        if (!nid) {
          nid = `cbq-${si + 1}-${quoteIds.size + 1}`;
          quoteIds.set(oldId, nid);
        }
        return { ...l, quote: { ...l.quote, id: nid } };
      });
      const effSystem = sec.roofSystem ?? srcSystem;
      const effAttach = sec.attachment ?? srcAttach;
      const effAdhesive = sec.membraneAdhesiveName ?? srcAdhesive;
      sections.push({
        ...sec,
        id,
        layers,
        underlaymentBoard: "",
        ...(effSystem !== roofSystem ? { roofSystem: effSystem } : {}),
        ...(effAttach !== attachment ? { attachment: effAttach } : {}),
        ...(effAdhesive !== membraneAdhesiveName && effAdhesive
          ? { membraneAdhesiveName: effAdhesive }
          : {}),
      });
    }
    for (const p of s.parapets ?? []) {
      const effSystem = p.roofSystem ?? srcSystem;
      const effAttach = p.attachment ?? srcAttach;
      const effAdhesive = p.membraneAdhesiveName ?? srcAdhesive;
      parapets.push({
        ...p,
        id: prefix + p.id,
        ...(effSystem !== roofSystem ? { roofSystem: effSystem } : {}),
        ...(effAttach !== attachment ? { attachment: effAttach } : {}),
        ...(effAdhesive !== membraneAdhesiveName && effAdhesive
          ? { membraneAdhesiveName: effAdhesive }
          : {}),
      });
    }
    for (const c of s.curbs ?? []) curbs.push({ ...c, id: prefix + c.id });
    sectionIdMaps.push(idMap);
  });

  const accessoriesCalc = mergeAccessories(
    sources.map((src, si) => ({
      st: normalizeAccessoriesState(src.saved.accessoriesCalc),
      sectionIds: sectionIdMaps[si]!,
    })),
  );
  const metalsCalc = mergeMetals(sources.map((src) => normalizeMetalsState(src.saved.metalsCalc)));
  const nonDlCalc = mergeNonDl(
    sources.map((src) => normalizeNonDlState(src.saved.nonDlCalc)),
    conflicts,
  );
  const accessories = mergeLines<AccessoryLine>(sources.map((s) => s.saved.accessories));
  const nonDlLines = mergeLines<NonDlLine>(sources.map((s) => s.saved.nonDlLines));
  const metals = mergeLines<NonDlLine>(sources.map((s) => s.saved.metals));

  const info: CombineInfo = {
    createdAt: now,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      client: s.saved.customer?.name?.trim() ?? "",
      estimator: s.saved.customer?.estimatorName?.trim() ?? "",
    })),
    conflicts,
  };

  const {
    adminSnapshot: _a,
    warrantySnapshot: _w,
    pricingAsOf: _p,
    underlaymentPriceOverrides: _u,
    ...freshRest
  } = fresh;
  const saved: SavedBidState = {
    ...freshRest,
    roofSystem,
    attachment,
    ...(membraneAdhesiveName ? { membraneAdhesiveName } : {}),
    sections,
    parapets,
    curbs,
    accessories,
    accessoriesCalc,
    metals,
    metalsCalc,
    nonDlLines,
    nonDlCalc,
    // Legacy CreateNew: a blank client; the combine summary is carried in combineInfo.
    customer: { ...emptyCustomer(), ...(fresh.customer ?? {}) },
    combineInfo: info,
  };
  return { saved, info, sectionIdMaps };
}

/** The legacy Bid Combiner warning (the combined estimate's Description), as plain lines. */
export function combineWarningLines(info: CombineInfo): string[] {
  const lines = [
    "This bid has been generated by the Bid Combiner. Base labor and item costs have been set according to the current defaults.",
    "Steps remaining:",
    "1. Fasteners have been recalculated — enter new quantities for the fastener items on the Accessories step.",
    "2. Review the Non-DL step and keep the items you want in the combined bid" +
      (info.conflicts.length
        ? ` (${info.conflicts.length} item${info.conflicts.length === 1 ? "" : "s"} combined with differing prices — see below).`
        : "."),
    "3. Use the Review step to set shipping and per diem.",
    "This bid was generated from: " +
      info.sources
        .map(
          (s) =>
            `“${s.name}”` +
            (s.client ? ` for ${s.client}` : "") +
            (s.estimator ? `, bid by ${s.estimator}` : ""),
        )
        .join("; "),
  ];
  return lines;
}
