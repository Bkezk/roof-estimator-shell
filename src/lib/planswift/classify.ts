/**
 * PlanSwift row → bid target (pure). PlanSwift names are typed by hand ("50 mill DT / Duro-Teck
 * TPO  2" Iso, 1/2" HD Poly ISO Coverboard", "Parapet  01  ( 6"_/ 102" )", "A/C  ( 98" X 110" X
 * 12" )", "tapperd Iso/ Crickets"), so each row is read by its unit first (SQ FT areas, FT
 * lengths, EA counts) and then by the words and numbers in its name. Every guess carries a
 * confidence and a reason; the import dialog shows them and lets the estimator change the target
 * (and remembers the change — see mapping-memory.ts).
 *
 * The details (membrane, parapet profile, curb size, pipe size) are read for EVERY row whatever
 * its guessed target, so a row moved to another target by hand still carries its numbers.
 */

import type { PlanSwiftRow } from "./parse";

export const PLANSWIFT_TARGETS = [
  "section",
  "tapered",
  "parapet",
  "coping",
  "gutter",
  "metals",
  "curb",
  "drain",
  "pipe",
  "accessory",
  "nondl",
  "unmatched",
  "skip",
] as const;
export type PlanSwiftTarget = (typeof PLANSWIFT_TARGETS)[number];

/** The review screen's target names. */
export const PLANSWIFT_TARGET_LABELS: Record<PlanSwiftTarget, string> = {
  section: "Roof section",
  tapered: "Tapered ISO quote",
  parapet: "Parapet",
  coping: "Coping",
  gutter: "Gutter",
  metals: "Metals line",
  curb: "Curb",
  drain: "Drain",
  pipe: "Pipe stack",
  accessory: "Accessory count",
  nondl: "Non-DL line",
  unmatched: "Place by hand",
  skip: "Skip",
};

export type Confidence = "high" | "medium" | "low";

export interface InsulationGuess {
  /** Layers of this board ("2 layers of 2.6 ISO" → 2). */
  count: number;
  thicknessIn: number;
  kind: "iso" | "hd-iso" | "coverboard" | "densdeck" | "eps" | "xps" | "fiberboard";
  /** The board as the estimator's list spells it when it has one (`2" ISO`, `1/2" HD ISO`). */
  boardName: string;
  /** The words as written in the name. */
  text: string;
}

export interface MembraneGuess {
  thicknessMil?: number;
  /** The estimator's roof system name ("Duro-Tech TPO", "EPDM Rubber", "Duro-Last", …). */
  roofSystem?: string;
  attachment?: "mechanical" | "adhered";
  /** The system words as written ("Duro-Teck", "TPO"). */
  systemWords: string[];
  layers: InsulationGuess[];
  /** What the name says that is not read into a field. */
  notes: string[];
}

export interface RowDetails {
  membrane?: MembraneGuess;
  /** Parapet profile (in): `( 6"_/ 102" )` → skirt 6, vertical 102. */
  skirtIn?: number;
  verticalIn?: number;
  /** Curb / unit size (in): first two = footprint, third = height. */
  widthIn?: number;
  lengthIn?: number;
  heightIn?: number;
  /** Pipe size (in): `4" Stacks` → 4. */
  sizeIn?: number;
  /** For metals / accessory / Non-DL rows: what it is and where the bid keeps it. */
  kind?: string;
  where?: string;
  /** The tapered quote's underlayment entry (NeedQuote board). */
  quoteBoard?: string;
}

export interface ClassifiedRow {
  row: PlanSwiftRow;
  /** The normalised name the mapping memory keys on. */
  key: string;
  target: PlanSwiftTarget;
  confidence: Confidence;
  reason: string;
  details: RowDetails;
  /** Set when the target came from the user's earlier choice for this name. */
  remembered?: boolean;
}

// ── Number helpers ────────────────────────────────────────────────────────────────────────────

/** "1/2" → 0.5, "1 1/2" → 1.5, "2.6" → 2.6, ".5" → 0.5. */
export function parseInchNumber(s: string): number | null {
  const t = s.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) {
    const d = Number(mixed[3]);
    return d > 0 ? Number(mixed[1]) + Number(mixed[2]) / d : null;
  }
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const d = Number(frac[2]);
    return d > 0 ? Number(frac[1]) / d : null;
  }
  const n = Number(t);
  return t && Number.isFinite(n) ? n : null;
}

/** 0.5 → `1/2`, 1.5 → `1 1/2`, 2 → `2`, 2.6 → `2.6` (eighths as fractions, else decimals). */
export function formatInches(x: number): string {
  const whole = Math.floor(x + 1e-9);
  const rest = x - whole;
  if (rest < 1e-9) return String(whole);
  const eighths = Math.round(rest * 8);
  if (Math.abs(rest * 8 - eighths) < 1e-6 && eighths > 0 && eighths < 8) {
    let n = eighths;
    let d = 8;
    while (n % 2 === 0) {
      n /= 2;
      d /= 2;
    }
    return whole ? `${whole} ${n}/${d}` : `${n}/${d}`;
  }
  return String(Math.round(x * 1000) / 1000);
}

const INCH_MARK = `(?:"|''|”|in\\b\\.?|inch(?:es)?\\b)`;
const NUM = `(\\d+(?:\\.\\d+)?)`;

/**
 * `26 X 26 X 12`, `( 98" X 110" X 12" )`, `30"x72"x16"`, `4' x 8'` (feet ×12). Two or three
 * numbers; null when the name has none.
 */
export function parseDims(name: string): { a: number; b: number; c?: number } | null {
  const part = `${NUM}\\s*('(?!')|${INCH_MARK})?`;
  const re = new RegExp(`${part}\\s*[x×*]\\s*${part}(?:\\s*[x×*]\\s*${part})?`, "i");
  const m = re.exec(name);
  if (!m) return null;
  const val = (n: string | undefined, unit: string | undefined) => {
    if (n === undefined) return undefined;
    const v = Number(n);
    return unit === "'" ? v * 12 : v;
  };
  const a = val(m[1], m[2])!;
  const b = val(m[3], m[4])!;
  const c = val(m[5], m[6]);
  if (!(a > 0) || !(b > 0)) return null;
  return c !== undefined && c > 0 ? { a, b, c } : { a, b };
}

/** `( 6"_/ 102" )`, `6" / 102"`, `(6"_/54")` → skirt 6, vertical 102. */
export function parseParapetProfile(name: string): { skirtIn: number; verticalIn: number } | null {
  const re = new RegExp(`${NUM}\\s*${INCH_MARK}?\\s*_?\\s*\\/\\s*${NUM}\\s*${INCH_MARK}?`, "i");
  const m = re.exec(name);
  if (!m) return null;
  const skirtIn = Number(m[1]);
  const verticalIn = Number(m[2]);
  if (!(verticalIn > 0)) return null;
  return { skirtIn, verticalIn };
}

/** `4" Stacks` → 4, `1 1/2" pipe` → 1.5, `3in vent stack` → 3. */
export function parsePipeSize(name: string): number | null {
  const re = new RegExp(`(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)\\s*${INCH_MARK}`, "i");
  const m = re.exec(name);
  if (!m) return null;
  const v = parseInchNumber(m[1]!);
  return v !== null && v > 0 ? v : null;
}

// ── Membrane ──────────────────────────────────────────────────────────────────────────────────

const SYSTEMS: Array<{ re: RegExp; system?: string; note?: string }> = [
  { re: /duro[\s-]*te(?:ch|ck|c|k)\b/i, system: "Duro-Tech TPO" },
  { re: /duro[\s-]*tuff/i, system: "Duro-Tuff" },
  { re: /duro[\s-]*bond/i, system: "Duro-Bond" },
  { re: /duro[\s-]*fleece/i, system: "Duro-Fleece" },
  { re: /duro[\s-]*last/i, system: "Duro-Last" },
  { re: /\bpvc\b/i, system: "Duro-Last" },
  { re: /\bepdm\b/i, system: "EPDM Rubber" },
  { re: /\btpo\b/i },
];

/**
 * Read a roof-area name: membrane mil (`50 mill`, `.60 mil`, `60 mil`), system words, attachment
 * and insulation layers (`2" Iso`, `1/2" HD Poly ISO Coverboard`, `2 layers of 2.6 ISO`).
 */
export function parseMembrane(name: string): MembraneGuess {
  const g: MembraneGuess = { systemWords: [], layers: [], notes: [] };
  let rest = ` ${name} `;
  const cut = (m: RegExpExecArray | null) => {
    if (m) rest = rest.replace(m[0], " ");
  };

  const mil = /(\.?\d+(?:\.\d+)?)\s*-?\s*mil+s?\b/i.exec(rest);
  if (mil) {
    const raw = mil[1]!;
    const v = raw.startsWith(".") ? Number(raw.slice(1).replace(/^0+/, "") || "0") : Number(raw);
    if (v > 0) g.thicknessMil = v;
    cut(mil);
  }

  for (const s of SYSTEMS) {
    const m = s.re.exec(rest);
    if (!m) continue;
    g.systemWords.push(m[0].trim());
    if (s.system && !g.roofSystem) g.roofSystem = s.system;
    cut(m);
  }
  if (!g.roofSystem && g.systemWords.some((w) => /tpo/i.test(w)))
    g.notes.push("TPO without a make: pick Duro-Tech TPO or Non-DL TPO on the section.");
  // "DT" beside Duro-Tech is the same system's initials.
  if (g.roofSystem === "Duro-Tech TPO") cut(/\bDT\b/.exec(rest));

  const adhered = /fully[\s-]*adhered|\badhered\b/i.exec(rest);
  if (adhered) {
    g.attachment = "adhered";
    cut(adhered);
  } else {
    const mech = /mech(?:anically)?\.?\s*(?:fastened|attached)?\b/i.exec(rest);
    if (mech) {
      g.attachment = "mechanical";
      cut(mech);
    }
  }

  const layerRe = new RegExp(
    `(?:(\\d+)\\s*layers?\\s*(?:of\\s*)?)?(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\.\\d+|\\d+)\\s*${INCH_MARK}?\\s*` +
      `((?:hd|high[\\s-]*density)\\s*(?:poly[\\s-]*)?iso(?:\\s*cover[\\s-]*board)?|(?:poly[\\s-]*)?iso(?:\\s*cover[\\s-]*board)?|polyiso|cover[\\s-]*board|dens[\\s-]*deck|\\beps\\b|\\bxps\\b|fiber[\\s-]*board|wood[\\s-]*fiber)`,
    "gi",
  );
  for (const m of [...rest.matchAll(layerRe)]) {
    const t = parseInchNumber(m[2]!);
    if (t === null || !(t > 0)) continue;
    const words = m[3]!.toLowerCase();
    const kind: InsulationGuess["kind"] = /hd|high/.test(words)
      ? "hd-iso"
      : /iso/.test(words)
        ? "iso"
        : /cover/.test(words)
          ? "coverboard"
          : /dens/.test(words)
            ? "densdeck"
            : /eps/.test(words)
              ? "eps"
              : /xps/.test(words)
                ? "xps"
                : "fiberboard";
    const inches = `${formatInches(t)}"`;
    const boardName =
      kind === "hd-iso"
        ? `${inches} HD ISO`
        : kind === "iso"
          ? `${inches} ISO`
          : kind === "densdeck"
            ? `${inches} Dens Deck`
            : `${inches} ${m[3]!.trim()}`;
    g.layers.push({
      count: m[1] ? Math.max(1, Number(m[1])) : 1,
      thicknessIn: t,
      kind,
      boardName,
      text: m[0].trim(),
    });
    rest = rest.replace(m[0], " ");
  }

  // Whatever words are left (beyond "Roof Type 2", punctuation and fillers) are kept as a note.
  const left = rest
    .replace(/roof\s*type\s*\d*/gi, " ")
    .replace(/[()[\]{},/\\;:+&_"'”-]/g, " ")
    .replace(/\b(?:and|over|with|w|of|on|the|a|an|new|roof|roofing|membrane|system)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/[a-z]{3,}/i.test(left)) g.notes.push(`Also in the name: "${left}".`);
  return g;
}

// ── Name normalisation (the mapping memory's key) ─────────────────────────────────────────────

/**
 * "Parapet  01  ( 6"_/ 102" )" and "Parapet 02 (6"_/36")" → "parapet"; "4" Stacks" → "stacks";
 * "Exhaust fans 26 X 26 X 12" → "exhaust fans". Numbers, sizes and punctuation drop out so
 * similar rows in the next export share one remembered choice.
 */
export function normalizeRowName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\d+(?:\.\d+)?\s*('|"|''|”)?\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*('|"|''|”)?\s*[x×*]\s*\d+(?:\.\d+)?)?/g,
      " ",
    )
    .replace(/\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+/g, " ")
    .replace(/\bmil+s?\b|\bin\b|\binch(?:es)?\b|\bft\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Classification ────────────────────────────────────────────────────────────────────────────

const has = (re: RegExp, s: string) => re.test(s);

/** FT rows that are sheet metal (Non-DL › Sheet Metals lines), with their display names. */
const FT_METALS: Array<{ re: RegExp; kind: string }> = [
  { re: /down\s*spouts?|\bd\.?s\.?\b/i, kind: "Downspouts" },
  { re: /drip\s*edge/i, kind: "Drip edge" },
  { re: /\brakes?\b/i, kind: "Rake" },
  { re: /head\s*wall/i, kind: "Head wall flashing" },
  { re: /j[\s-]*chan+el/i, kind: "J-channel" },
  { re: /\bsills?\b/i, kind: "Sill" },
  { re: /\bheaders?\b/i, kind: "Header" },
  { re: /\bjam(?:b)?s?\b/i, kind: "Jamb" },
  { re: /(?:outside|inside)\s*corners?|\bcorners?\b/i, kind: "Corners" },
  { re: /\bbase\b/i, kind: "Base flashing" },
  { re: /counter\s*flash/i, kind: "Counter flashing" },
  { re: /gravel\s*stop/i, kind: "Gravel stop" },
  { re: /fascia/i, kind: "Fascia" },
  { re: /edge\s*metal|\bflashing\b|\btrim\b/i, kind: "Edge metal" },
  { re: /expansion\s*joint/i, kind: "Expansion joint" },
];

const SHEET_METALS = "Non-DL › Sheet Metals";

function classifyTarget(
  row: PlanSwiftRow,
  d: RowDetails,
): { target: PlanSwiftTarget; confidence: Confidence; reason: string; details: RowDetails } {
  const n = row.name;
  const out = (
    target: PlanSwiftTarget,
    confidence: Confidence,
    reason: string,
    extra: RowDetails = {},
  ) => ({ target, confidence, reason, details: { ...d, ...extra } });

  if (row.unitKind === "sqft") {
    if (has(/tap+er|cricket|saddle/i, n)) {
      const cricketsOnly = has(/cricket|saddle/i, n) && !has(/tap+er/i, n);
      return out("tapered", "high", "the name says tapered / crickets", {
        quoteBoard: cricketsOnly ? "Tapered Crickets" : "Tapered ISO",
      });
    }
    if (has(/wall\s*panel|\bacm\b|siding|soffit|metal\s*panel|composite\s*panel/i, n))
      return out("nondl", "medium", "wall or panel work, not roof area", {
        kind: n.trim(),
        where: "Non-DL › Contractor Applications",
      });
    const m = d.membrane;
    const insulationOnly =
      has(/\biso\b|insulation|cover\s*board|polyiso/i, n) &&
      !m?.roofSystem &&
      !m?.systemWords.length &&
      m?.thicknessMil === undefined &&
      !has(/roof/i, n);
    if (insulationOnly)
      return out("tapered", "medium", "insulation only — check it is the tapered quote", {
        quoteBoard: "Tapered ISO",
      });
    if (has(/\balt\b|alternate/i, n))
      return out("section", "low", "an alternate (Alt) — keep it only if this bid prices it");
    if (m?.roofSystem || m?.systemWords.length || m?.thicknessMil !== undefined)
      return out("section", "high", "a roof area with its membrane in the name");
    if (has(/roof/i, n)) return out("section", "high", "a roof area");
    return out("section", "medium", "an area in square feet");
  }

  if (row.unitKind === "ft") {
    if (has(/measur|\bcheck\b|verify|\btest\b/i, n))
      return out("unmatched", "low", "looks like a check measurement");
    if (has(/parapet/i, n))
      return out(
        "parapet",
        d.verticalIn !== undefined ? "high" : "medium",
        d.verticalIn !== undefined
          ? "the name says parapet, with its profile"
          : "the name says parapet (no height in the name)",
      );
    if (has(/coping/i, n))
      return out("coping", "high", "the name says coping", {
        kind: "Coping",
        where: SHEET_METALS,
      });
    if (has(/\bcap\b/i, n))
      return out("coping", "medium", "a cap — read as coping", {
        kind: "Coping",
        where: SHEET_METALS,
      });
    if (has(/gutter/i, n))
      return out("gutter", "high", "the name says gutter", { where: "Metals › Gutters" });
    if (has(/walk\s*(?:way|pad)/i, n))
      return out("accessory", "medium", "walkway pads", {
        kind: "Walk pads",
        where: "Accessories › Walk Pads",
      });
    for (const m of FT_METALS)
      if (m.re.test(n))
        return out("metals", m.kind === "Expansion joint" ? "medium" : "high", m.kind, {
          kind: m.kind,
          where: SHEET_METALS,
        });
    return out("unmatched", "low", "a length the importer does not recognise");
  }

  if (row.unitKind === "ea") {
    if (d.widthIn !== undefined && d.lengthIn !== undefined)
      return out("curb", "high", "a unit with a W × L × H size — a curb");
    if (
      has(/curb|hatch|exhaust|\bfans?\b|a\s*\/\s*c\b|\bac\b|\brtu\b|hvac|skylight|smoke\s*vent/i, n)
    )
      return out("curb", "medium", "a curbed unit with no size in the name");
    if (has(/drain/i, n)) return out("drain", "high", "the name says drain");
    if (has(/stack|pipe|plumb|\bvtr\b/i, n))
      return out(
        "pipe",
        d.sizeIn !== undefined ? "high" : "medium",
        d.sizeIn !== undefined ? "a pipe stack with its size" : "a pipe stack with no size",
      );
    if (has(/boot/i, n)) return out("unmatched", "low", "downspout boots have no place in the bid");
    if (has(/down\s*spouts?|\bd\.?s\.?\b/i, n))
      return out("metals", "medium", "downspouts (a count)", {
        kind: "Downspouts",
        where: SHEET_METALS,
      });
    if (has(/collector|conductor\s*head|scupper/i, n))
      return out("metals", "medium", "collector heads / scuppers", {
        kind: has(/scupper/i, n) ? "Scuppers" : "Collector heads",
        where: SHEET_METALS,
      });
    if (has(/pitch\s*pan/i, n))
      return out("metals", "medium", "pitch pans", { kind: "Pitch pans", where: SHEET_METALS });
    if (has(/\bvents?\b/i, n))
      return out("accessory", "medium", "vents", {
        kind: "Vents",
        where: "Accessories › Vents",
      });
    if (has(/walk\s*(?:way|pad)/i, n))
      return out("accessory", "medium", "walk pads", {
        kind: "Walk pads",
        where: "Accessories › Walk Pads",
      });
    if (has(/\bhubs?\b/i, n))
      return out("accessory", "low", "a hub — place it where it belongs", {
        kind: n.trim(),
        where: "Accessories",
      });
    if (has(/splash\s*block/i, n))
      return out("unmatched", "low", "splash blocks have no place in the bid");
    return out("unmatched", "low", "a count the importer does not recognise");
  }

  return out("unmatched", "low", `unit "${row.units || "blank"}" is not SQ FT, FT or EA`);
}

/** Read one row: its details, then its most likely target. */
export function classifyRow(row: PlanSwiftRow): ClassifiedRow {
  const d: RowDetails = {};
  if (row.unitKind === "sqft" || row.unitKind === "other") d.membrane = parseMembrane(row.name);
  const prof = parseParapetProfile(row.name);
  if (prof) {
    d.skirtIn = prof.skirtIn;
    d.verticalIn = prof.verticalIn;
  } else if (row.wallHeight !== null && row.wallHeight > 0 && /parapet/i.test(row.name)) {
    // PlanSwift's Wall Height is in feet.
    d.verticalIn = Math.round(row.wallHeight * 12 * 100) / 100;
  }
  const dims = parseDims(row.name);
  if (dims) {
    d.widthIn = dims.a;
    d.lengthIn = dims.b;
    if (dims.c !== undefined) d.heightIn = dims.c;
  }
  if (!dims) {
    const size = parsePipeSize(row.name);
    if (size !== null && row.unitKind === "ea") d.sizeIn = size;
  }
  const c = classifyTarget(row, d);
  return {
    row,
    key: normalizeRowName(row.name),
    target: c.target,
    confidence: c.confidence,
    reason: c.reason,
    details: c.details,
  };
}

export function classifyRows(rows: readonly PlanSwiftRow[]): ClassifiedRow[] {
  return rows.map(classifyRow);
}

const num = (x: number) =>
  x.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/**
 * What the row becomes under `target`, in words: "curb 26 × 26 × 12 in, ×10", "parapet skirt
 * 6", vertical 102", 604.56 ft", "section 13,445.64 sq ft · 50 mil Duro-Tech TPO · 2" ISO + 1/2"
 * HD ISO".
 */
export function describeTarget(c: ClassifiedRow, target: PlanSwiftTarget = c.target): string {
  const d = c.details;
  const r = c.row;
  const unit = r.unitKind === "sqft" ? "sq ft" : r.unitKind === "ft" ? "ft" : r.units || "";
  const q = `${num(r.qty)} ${unit}`.trim();
  switch (target) {
    case "section": {
      const m = d.membrane;
      const parts = [`section ${q}`];
      if (m?.thicknessMil || m?.roofSystem)
        parts.push(
          [m.thicknessMil ? `${m.thicknessMil} mil` : "", m.roofSystem ?? ""].join(" ").trim(),
        );
      if (m?.attachment) parts.push(m.attachment === "adhered" ? "adhered" : "mechanical");
      if (m?.layers.length)
        parts.push(
          m.layers
            .map((l) => (l.count > 1 ? `${l.count} × ${l.boardName}` : l.boardName))
            .join(" + "),
        );
      if (r.linearTotal !== null && r.linearTotal > 0)
        parts.push(`perimeter ${num(r.linearTotal)} ft`);
      return parts.join(" · ");
    }
    case "tapered":
      return `${d.quoteBoard ?? "Tapered ISO"} quote layer, ${q}`;
    case "parapet": {
      const prof =
        d.verticalIn !== undefined
          ? `skirt ${num(d.skirtIn ?? 6)}", vertical ${num(d.verticalIn)}", `
          : "no height in the name, ";
      return `parapet ${prof}${q}`;
    }
    case "curb": {
      const size =
        d.widthIn !== undefined && d.lengthIn !== undefined
          ? `${num(d.widthIn)} × ${num(d.lengthIn)}${d.heightIn !== undefined ? ` × ${num(d.heightIn)}` : ""} in`
          : "no size in the name";
      return `curb ${size}, ×${num(r.qty)}`;
    }
    case "pipe":
      return `pipe stack ${d.sizeIn !== undefined ? `${formatInches(d.sizeIn)}"` : "(no size)"}, ×${num(r.qty)}`;
    case "drain":
      return `drains ×${num(r.qty)}`;
    case "coping":
      return `coping ${q} (a Sheet Metals line)`;
    case "gutter":
      return `gutter ${q} (Metals › Gutters)`;
    case "metals":
      return `${d.kind ?? r.name} ${q} (a Sheet Metals line)`;
    case "nondl":
      return `${q} (a Contractor Applications line)`;
    case "accessory":
      return `${d.kind ?? r.name} ${q}${d.where ? ` (${d.where})` : ""}`;
    case "skip":
      return "left out of the bid";
    case "unmatched":
      return `${q} — listed on the bid to place by hand`;
  }
}
