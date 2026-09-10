/**
 * The legacy Accessories tab (captured 2026-08-31, shots 122633–123726): a left tree of 21
 * calculated screens in four groups, each screen mirroring its captured legacy layout. All money
 * math lives in the engine (src/lib/engine/accessories.ts — docs §12); this component only binds
 * the screens' green (editable) cells to AccessoriesState and renders the engine's computed
 * white (read-only) values.
 */

import { useMemo, useState } from "react";

import {
  EDGE_FASTENER_GROUPS,
  PLATE_ROWS,
  SNAP_SIZES,
  TERM_COLORS,
  type AccessoriesResult,
  type AccessoriesState,
  type AccessoryRefData,
  type DeckBucket,
  type FastenerSlot,
  type SnapSize,
} from "@/lib/engine/accessories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Native checkbox (legacy-style). Deliberately NOT the Radix Checkbox: this file was the app's
 * first Radix-checkbox importer, and the new dep chunk re-optimized Vite's deps mid-session in
 * the hosted preview, duplicating React (null hooks dispatcher → blank screen).
 */
function Checkbox(props: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="h-3.5 w-3.5 accent-primary"
      checked={props.checked}
      onChange={(e) => props.onCheckedChange(e.target.checked)}
    />
  );
}

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hrs2 = (v: number) => v.toFixed(2).replace(/\.00$/, "") + " h";

/** Screen ids in tree order. */
type ScreenId =
  | "corners"
  | "pipeStacks"
  | "washers"
  | "drains"
  | "walkPads"
  | "termBar"
  | "fascia3"
  | "fascia4"
  | "gravelStop"
  | "dripEdge"
  | "snapCover"
  | "panduit"
  | "sealants"
  | "adhesives"
  | "membraneAccs"
  | "vents"
  | "parapetTabs"
  | DeckBucket;

const TREE: Array<{ label: string; items: Array<{ id: ScreenId; label: string }> }> = [
  {
    label: "Flashing & Other Accessories",
    items: [
      { id: "corners", label: "Corners" },
      { id: "pipeStacks", label: "Pipe Stacks" },
      { id: "washers", label: "Conduit Washers" },
      { id: "drains", label: "Roof Drains & Boots" },
      { id: "walkPads", label: "Walk Pads" },
    ],
  },
  {
    label: "Edge Terminations",
    items: [
      { id: "termBar", label: "Term Bar" },
      { id: "fascia3", label: '1-3/4" Fascia' },
      { id: "fascia4", label: '4" Fascia' },
      { id: "gravelStop", label: "Gravel Stop" },
      { id: "dripEdge", label: "Drip Edge" },
      { id: "snapCover", label: "Base & Snap Cover" },
    ],
  },
  {
    label: "Calculated Items",
    items: [
      { id: "panduit", label: "Panduit Straps" },
      { id: "sealants", label: "Sealants" },
      { id: "adhesives", label: "Adhesives" },
      { id: "membraneAccs", label: "Membrane Acc." },
      { id: "vents", label: "Vents" },
    ],
  },
  {
    label: "Fasteners & Related",
    items: [
      { id: "parapetTabs", label: "Parapet Wall-Tabs and Steel Plates" },
      { id: "wood", label: "Wood" },
      { id: "metal", label: "Metal, Metal Retrofit & Purlin" },
      { id: "gypsum", label: "Gypsum, Tectum & LW" },
      { id: "concrete", label: "Concrete" },
      { id: "lwConcrete", label: "LW Over Concrete" },
      { id: "lwSteel", label: "LW Over Steel" },
    ],
  },
];

export interface AccessoriesScreensProps {
  state: AccessoriesState;
  onChange: (next: AccessoriesState) => void;
  refData: AccessoryRefData | undefined;
  result: AccessoriesResult | undefined;
  /** Sections for the derived stripping rows + colour columns. */
  sections: Array<{ id: string; name: string; color: string }>;
  /** Adhesive names + the engine's §2.4 whole-unit Calc Qty per adhesive. */
  adhesiveNames: string[];
  adhesiveCalc: Record<string, number> | undefined;
  /** The §8.6 ARP calc (Ceil section + Ceil parapet sq ft) for the Membrane Accs row. */
  arpCalcQty: number;
}

/** Small green editable number cell (legacy CellType 1 / LightGreen). */
function Num(props: {
  value: number;
  onCommit: (v: number) => void;
  w?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      type="number"
      inputMode="decimal"
      disabled={props.disabled ?? false}
      className={`h-7 ${props.w ?? "w-20"} bg-green-50 px-1 text-right text-xs tabular-nums dark:bg-green-950`}
      value={text ?? (props.value === 0 ? "" : String(props.value))}
      placeholder="0"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== null) {
          const v = Number(text);
          // Quantities and footages are never negative.
          props.onCommit(Number.isFinite(v) ? Math.max(0, v) : 0);
          setText(null);
        }
      }}
    />
  );
}

/** Read-only white computed cell. */
const RO = ({ v, w }: { v: string | number; w?: string }) => (
  <span
    className={`inline-block ${w ?? "w-20"} rounded border bg-background px-1 py-0.5 text-right text-xs tabular-nums`}
  >
    {v}
  </span>
);

/** The legacy "Labor: X h. (Y%)" link with an inline percent editor (§8.7 AdjustLabor). */
function LaborLink(props: {
  hours: number;
  pct: number;
  onPct?: (v: number) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {props.label !== undefined && <span>{props.label}</span>}
      <button
        type="button"
        className="text-primary underline decoration-dotted underline-offset-2"
        onClick={() => props.onPct && setOpen((o) => !o)}
        title={props.onPct ? "Adjust this item's labor (legacy AdjustLabor %)" : undefined}
      >
        {hrs2(props.hours)}
        {props.onPct ? ` (${100 + (props.pct || 0)}%)` : ""}
      </button>
      {open && props.onPct && (
        <span className="inline-flex items-center gap-1">
          <Input
            type="number"
            className="h-6 w-16 px-1 text-right text-xs"
            defaultValue={100 + (props.pct || 0)}
            onBlur={(e) => {
              const v = Number(e.target.value);
              // The percent is floored at 0 (adjust ≥ −100) so hours can never go negative.
              props.onPct!(Number.isFinite(v) ? Math.max(0, Math.round(v)) - 100 : 0);
              setOpen(false);
            }}
          />
          <span className="text-muted-foreground">%</span>
        </span>
      )}
    </span>
  );
}

/** Pipe Stacks (§12.3): entry form (Qty / Usage / Color / Open-Closed / Size) → Save → list. */
function PipeStacksScreen(
  props: AccessoriesScreensProps & { upd: (fn: (d: AccessoriesState) => void) => void },
) {
  const { state, refData, result, upd } = props;
  const [qty, setQty] = useState(1);
  const [usage, setUsage] = useState("Plumbing");
  const [color, setColor] = useState("White");
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const sizes = refData?.pipeStackSizes ?? [];
  const sizeRef = sizes.find((s) => s.size === size);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Pipe Stacks</h3>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="space-y-1">
          <span>Quantity:</span>
          <Input
            type="number"
            className="h-7 w-16 px-1 text-right text-xs"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="space-y-1">
          <span>Pipe Stack Usage:</span>
          <Select value={usage} onValueChange={setUsage}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(refData?.pipeStackUsages ?? []).map((u) => (
                <SelectItem key={u.name} value={u.name}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span>Color:</span>
          <Select value={color} onValueChange={setColor}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["White", "Tan", "Gray", "Dark Gray", "Terra Cotta", "Rock Ply"].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span>Open/Closed:</span>
          <Select
            value={open ? "Open" : "Closed"}
            onValueChange={(v) => setOpen(v === "Open")}
            disabled={sizeRef?.closedOnly ?? false}
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Closed">Closed</SelectItem>
              <SelectItem value="Open">Open</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span>Size:</span>
          <Select
            value={size !== null ? String(size) : ""}
            onValueChange={(v) => {
              const n = Number(v);
              setSize(n);
              if (sizes.find((s) => s.size === n)?.closedOnly) setOpen(false);
            }}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              {sizes.map((s) => (
                <SelectItem key={s.size} value={String(s.size)}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={size === null}
          onClick={() =>
            upd((d) => {
              d.pipeStacks.push({
                id: crypto.randomUUID(),
                usage,
                color,
                open: sizeRef?.closedOnly ? false : open,
                size: size!,
                quantity: qty,
                adjustPct: 0,
              });
            })
          }
        >
          Save
        </Button>
      </div>
      <table className="text-xs">
        <thead>
          <tr>
            {["Usage", "Color", "Open/Closed", "Size", "Quantity", "Labor", ""].map((h) => (
              <th key={h} className="border bg-muted px-2 py-1 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.pipeStacks.map((ps, i) => (
            <tr key={ps.id}>
              <td className="border px-2 py-0.5">{ps.usage}</td>
              <td className="border px-2 py-0.5">{ps.color}</td>
              <td className="border px-2 py-0.5">{ps.open ? "Open" : "Closed"}</td>
              <td className="border px-2 py-0.5">{ps.size}"</td>
              <td className="border px-2 py-0.5 text-right">{ps.quantity}</td>
              <td className="border px-2 py-0.5">
                <LaborLink
                  hours={result?.pipeStacks.perStackHours[ps.id] ?? 0}
                  pct={ps.adjustPct}
                  onPct={(v) => upd((d) => (d.pipeStacks[i]!.adjustPct = v))}
                />
              </td>
              <td className="border px-1 py-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => upd((d) => d.pipeStacks.splice(i, 1))}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Material: {usd(result?.pipeStacks.cost ?? 0)} — Total Labor:{" "}
        {hrs2(result?.pipeStacks.hours ?? 0)}
      </p>
    </div>
  );
}

/** Roof Drains & Boots (§12.3): entry form → Save → list, + the strainer grid. */
function DrainsScreen(
  props: AccessoriesScreensProps & { upd: (fn: (d: AccessoriesState) => void) => void },
) {
  const { state, refData, result, upd } = props;
  const [qty, setQty] = useState(1);
  const [roofType, setRoofType] = useState("None");
  const [reuse, setReuse] = useState(false);
  const [boot, setBoot] = useState("");
  const [ring, setRing] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Drains</h3>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="space-y-1">
          <span>Qty:</span>
          <Input
            type="number"
            className="h-7 w-16 px-1 text-right text-xs"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="space-y-1">
          <span>Existing Roof:</span>
          <Select value={roofType} onValueChange={setRoofType}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(refData?.drainRoofTypes ?? []).map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1 pb-1">
          <Checkbox checked={reuse} onCheckedChange={(v) => setReuse(v === true)} />
          Reuse Existing Drain Rings
        </label>
        <label className="space-y-1">
          <span>Drain Boot Size:</span>
          <Select value={boot} onValueChange={setBoot}>
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue placeholder="Boot" />
            </SelectTrigger>
            <SelectContent>
              {(refData?.drainBoots ?? []).map((b) => (
                <SelectItem key={b.description} value={b.description}>
                  {b.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span>Drain Ring Size:</span>
          <Select value={ring} onValueChange={setRing}>
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue placeholder="Ring" />
            </SelectTrigger>
            <SelectContent>
              {(refData?.drainRings ?? []).map((r) => (
                <SelectItem key={r.description} value={r.description}>
                  {r.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!boot || !ring}
          onClick={() =>
            upd((d) => {
              d.drains.push({
                id: crypto.randomUUID(),
                quantity: qty,
                roofType,
                reuseRings: reuse,
                bootSize: boot,
                ringSize: ring,
                adjustPct: 0,
              });
            })
          }
        >
          Save
        </Button>
      </div>
      <table className="text-xs">
        <thead>
          <tr>
            {["Qty", "Existing Roof", "Reuse Rings", "Boot", "Ring", "Labor", ""].map((h) => (
              <th key={h} className="border bg-muted px-2 py-1 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.drains.map((dr, i) => (
            <tr key={dr.id}>
              <td className="border px-2 py-0.5 text-right">{dr.quantity}</td>
              <td className="border px-2 py-0.5">{dr.roofType}</td>
              <td className="border px-2 py-0.5">{dr.reuseRings ? "Yes" : "No"}</td>
              <td className="border px-2 py-0.5">{dr.bootSize}</td>
              <td className="border px-2 py-0.5">{dr.ringSize}</td>
              <td className="border px-2 py-0.5">
                <LaborLink
                  hours={result?.drains.perDrainHours[dr.id] ?? 0}
                  pct={dr.adjustPct}
                  onPct={(v) => upd((d) => (d.drains[i]!.adjustPct = v))}
                />
              </td>
              <td className="border px-1 py-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => upd((d) => d.drains.splice(i, 1))}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Drain material: {usd(result?.drains.cost ?? 0)} (reused rings bill $0) — Total Labor:{" "}
        {hrs2(result?.drains.hours ?? 0)}
      </p>
      <div className="space-y-1">
        <p className="text-xs font-semibold">Drain Accessories</p>
        <table className="text-xs">
          <thead>
            <tr>
              <th className="border bg-muted px-2 py-1 text-left">Strainers</th>
              <th className="border bg-muted px-2 py-1">Quantity</th>
              <th className="border bg-muted px-2 py-1">Hours/Unit</th>
            </tr>
          </thead>
          <tbody>
            {(refData?.strainers ?? []).map((s) => (
              <tr key={s.description}>
                <td className="border px-2 py-0.5">{s.description}</td>
                <td className="border px-1 py-0.5">
                  <Num
                    w="w-14"
                    value={state.strainers.qty[s.description] ?? 0}
                    onCommit={(v) => upd((d) => (d.strainers.qty[s.description] = v))}
                  />
                </td>
                <td className="border px-2 py-0.5 text-right">{s.hours.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <LaborLink
          label="Labor:"
          hours={result?.strainers.hours ?? 0}
          pct={state.strainers.adjustPct}
          onPct={(v) => upd((d) => (d.strainers.adjustPct = v))}
        />
      </div>
    </div>
  );
}

/** Natural inch-size sort key for fastener descriptions (`1 1/2"` → 1.5, `10"` → 10). */
function inchKey(desc: string): number {
  const m = /^(\d+)(?:\s+(\d+)\/(\d+))?"/.exec(desc.trim());
  if (!m) return 999;
  return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

export function AccessoriesScreens(props: AccessoriesScreensProps) {
  const { state, onChange, refData, result } = props;
  const [screenId, setScreenId] = useState<ScreenId>("termBar");
  const [snapSize, setSnapSize] = useState<SnapSize>("3");

  const upd = (fn: (draft: AccessoriesState) => void) => {
    const next = structuredClone(state);
    fn(next);
    onChange(next);
  };

  const setFastener = (slot: FastenerSlot, key: string, qty: number) =>
    upd((d) => {
      const m = (d.fastenerQty[slot] ??= {});
      if (qty > 0) m[key] = qty;
      else delete m[key];
    });

  const fastenerRowsByKey = useMemo(
    () => new Map((refData?.fasteners ?? []).map((f) => [f.key, f])),
    [refData],
  );

  /** Screens with an unmet need (red counters) — their tree names show red until covered. */
  const screenNeedsAttention = useMemo(() => {
    const out = new Set<ScreenId>();
    if (!result) return out;
    if (result.termBar.fastenersNeeded > 0) out.add("termBar");
    if (result.fascia["3"].fastenersNeeded > 0) out.add("fascia3");
    if (result.fascia["4"].fastenersNeeded > 0) out.add("fascia4");
    if (result.dripEdge.fastenersNeeded > 0) out.add("dripEdge");
    if (result.gravelStop.fastenersNeeded > 0) out.add("gravelStop");
    if (result.snapCover.fastenersNeeded > 0) out.add("snapCover");
    if (result.parapetTabs.fastenersNeeded > 0 || result.parapetTabs.steelPlatesNeeded > 0)
      out.add("parapetTabs");
    for (const [bucket, n] of Object.entries(result.deckNeeds)) {
      if (n.fasteners > 0 || n.polyPlates > 0 || n.insulPlates > 0 || n.inductionPlates > 0)
        out.add(bucket as ScreenId);
    }
    return out;
  }, [result]);

  if (!refData) {
    return (
      <p className="text-sm text-muted-foreground">
        Accessory ref data isn't in this bid's frozen pricing snapshot — update the bid's pricing
        (Update Pricing &amp; Labor) to enable the calculated Accessories screens.
      </p>
    );
  }

  /** A labelled fastener grid bound to one slot; rows from a captured group list or keys. */
  const FastenerGrid = ({
    slot,
    keys,
    title,
    needed,
  }: {
    slot: FastenerSlot;
    keys: string[];
    title?: string;
    needed?: number;
  }) => (
    <div className="space-y-1">
      {needed !== undefined && (
        <p className={`text-xs font-medium ${needed > 0 ? "text-red-600" : ""}`}>
          Fasteners Needed: {needed}
        </p>
      )}
      {title && <p className="text-xs font-semibold">{title}</p>}
      <table className="text-xs">
        <tbody>
          {keys.map((key) => {
            const row = fastenerRowsByKey.get(key);
            if (!row) return null;
            const label =
              row.subtype && !/plates|anchors/i.test(row.description)
                ? `${row.description} ${row.subtype}`
                : row.description;
            return (
              <tr key={key}>
                <td className="pr-1">
                  <Num
                    w="w-16"
                    value={state.fastenerQty[slot]?.[key] ?? 0}
                    onCommit={(v) => setFastener(slot, key, v)}
                  />
                </td>
                <td className="border px-2 py-0.5">{label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /** All catalog rows of the given subtypes, size-sorted, bound to a slot (deck screens). */
  const SubtypeColumn = ({
    slot,
    subtypes,
    title,
  }: {
    slot: FastenerSlot;
    subtypes: string[];
    title: string;
  }) => {
    const rows = (refData.fasteners ?? [])
      .filter((f) => subtypes.includes(f.subtype))
      .sort((a, b) => inchKey(a.description) - inchKey(b.description));
    return (
      <div>
        <p className="mb-1 text-xs font-semibold">{title}</p>
        <table className="text-xs">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="pr-1">
                  <Num
                    w="w-16"
                    value={state.fastenerQty[slot]?.[row.key] ?? 0}
                    onCommit={(v) => setFastener(slot, row.key, v)}
                  />
                </td>
                <td className="border px-2 py-0.5 whitespace-nowrap">{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const screen = (() => {
    switch (screenId) {
      /* ---------------- Flashing & Other Accessories ---------------- */
      case "corners": {
        const colors = ["White", "Tan", "Gray", "Dark Gray", "Terra Cotta"];
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <h3 className="text-sm font-semibold">Corners</h3>
              <LaborLink
                hours={result?.corners.hours ?? 0}
                pct={state.corners.adjustPct}
                onPct={(v) => upd((d) => (d.corners.adjustPct = v))}
                label="Labor:"
              />
            </div>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Corner</th>
                  {colors.map((c) => (
                    <th key={c} className="border bg-muted px-2 py-1">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refData.corners.map((row) => (
                  <tr key={row.description}>
                    <td className="border px-2 py-0.5">{row.description}</td>
                    {colors.map((c) => (
                      <td key={c} className="border px-1 py-0.5">
                        {row.priceByColor[c] !== undefined ? (
                          <Num
                            w="w-14"
                            value={state.corners.qty[row.description]?.[c] ?? 0}
                            onCommit={(v) =>
                              upd((d) => {
                                (d.corners.qty[row.description] ??= {})[c] = v;
                              })
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              Material: {usd(result?.corners.cost ?? 0)}
            </p>
          </div>
        );
      }
      case "pipeStacks": {
        return <PipeStacksScreen {...props} upd={upd} />;
      }
      case "washers": {
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Conduit Washers</h3>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Description</th>
                  <th className="border bg-muted px-2 py-1">Qty</th>
                </tr>
              </thead>
              <tbody>
                {refData.washers.map((w) => (
                  <tr key={w.description}>
                    <td className="border px-2 py-0.5">{w.description}</td>
                    <td className="border px-1 py-0.5">
                      <Num
                        w="w-16"
                        value={state.washers.qty[w.description] ?? 0}
                        onCommit={(v) => upd((d) => (d.washers.qty[w.description] = v))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LaborLink
              hours={result?.washers.hours ?? 0}
              pct={state.washers.adjustPct}
              onPct={(v) => upd((d) => (d.washers.adjustPct = v))}
              label="Labor:"
            />
          </div>
        );
      }
      case "drains": {
        return <DrainsScreen {...props} upd={upd} />;
      }
      case "walkPads": {
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Walk Pads &amp; Wall Vents</h3>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Description</th>
                  <th className="border bg-muted px-2 py-1">Qty</th>
                </tr>
              </thead>
              <tbody>
                {refData.walkPads.map((w) => (
                  <tr key={w.description}>
                    <td className="border px-2 py-0.5">{w.description}</td>
                    <td className="border px-1 py-0.5">
                      <Num
                        w="w-16"
                        value={state.walkPads.qty[w.description] ?? 0}
                        onCommit={(v) => upd((d) => (d.walkPads.qty[w.description] = v))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LaborLink
              hours={result?.walkPads.hours ?? 0}
              pct={state.walkPads.adjustPct}
              onPct={(v) => upd((d) => (d.walkPads.adjustPct = v))}
              label="Labor:"
            />
          </div>
        );
      }

      /* ---------------- Edge Terminations ---------------- */
      case "termBar": {
        const r = result?.termBar;
        const tb = state.termBar;
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
              <span>Roof Edges: {r?.counts.roofEdgesFt ?? 0}</span>
              <span>Parapets: {r?.counts.parapetsFt ?? 0}</span>
              <span>Curbs: {(r?.counts.curbsFt ?? 0).toLocaleString()}</span>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {(["noDrill", "preDrill"] as const).map((drill) => (
                <div key={drill} className="space-y-1">
                  <p className="text-xs font-semibold">
                    {drill === "noDrill" ? "No Drill" : "Pre-Drill"}
                  </p>
                  <table className="text-xs">
                    <thead>
                      <tr>
                        <th className="border bg-muted px-2 py-1 text-left">Color</th>
                        <th className="border bg-muted px-2 py-1">Calculated (ft)</th>
                        <th className="border bg-muted px-2 py-1">Additional (ft)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TERM_COLORS.map((c) => (
                        <tr key={c}>
                          <td className="border px-2 py-0.5">{c}</td>
                          <td className="border px-1 py-0.5 text-right">
                            <RO
                              v={
                                drill === "noDrill"
                                  ? (r?.noDrillByColor[c] ?? 0)
                                  : (r?.preDrillByColor[c] ?? 0)
                              }
                            />
                          </td>
                          <td className="border px-1 py-0.5">
                            <Num
                              value={
                                (drill === "noDrill"
                                  ? tb.additionalNoDrill
                                  : tb.additionalPreDrill)[c] ?? 0
                              }
                              onCommit={(v) =>
                                upd((d) => {
                                  (drill === "noDrill"
                                    ? d.termBar.additionalNoDrill
                                    : d.termBar.additionalPreDrill)[c] = v;
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="border px-2 py-0.5 text-muted-foreground">
                          Peel Stop (legacy: inactive)
                        </td>
                        <td className="border px-1 py-0.5 text-right">
                          <RO v={0} />
                        </td>
                        <td className="border px-1 py-0.5 text-right">
                          <RO v={0} />
                        </td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-0.5">Parapet base (white)</td>
                        <td className="border px-1 py-0.5 text-right">
                          <RO
                            v={
                              drill === "noDrill"
                                ? (r?.baseNoDrillFt ?? 0)
                                : (r?.basePreDrillFt ?? 0)
                            }
                          />
                        </td>
                        <td className="border px-1 py-0.5" />
                      </tr>
                      <tr>
                        <td className="border px-2 py-0.5 font-medium">Sub-Total</td>
                        <td className="border px-1 py-0.5 text-right" colSpan={2}>
                          <RO
                            v={`${drill === "noDrill" ? (r?.subTotalNoDrill ?? 0) : (r?.subTotalPreDrill ?? 0)} ft`}
                            w="w-24"
                          />
                        </td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-0.5">Labor</td>
                        <td className="border px-1 py-0.5" colSpan={2}>
                          <LaborLink
                            hours={
                              drill === "noDrill"
                                ? (r?.linkBaseHours.noDrill ?? 0)
                                : (r?.linkBaseHours.preDrill ?? 0)
                            }
                            pct={drill === "noDrill" ? tb.adjustNoDrillPct : tb.adjustPreDrillPct}
                            onPct={(v) =>
                              upd((d) => {
                                if (drill === "noDrill") d.termBar.adjustNoDrillPct = v;
                                else d.termBar.adjustPreDrillPct = v;
                              })
                            }
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-1">
                <Checkbox
                  checked={tb.stripMastic}
                  onCheckedChange={(v) => upd((d) => (d.termBar.stripMastic = v === true))}
                />
                Use Strip Mastic
              </label>
              {tb.stripMastic && (
                <span className="flex items-center gap-1">
                  Length (ft):
                  <Num
                    value={tb.stripMasticLengthFt ?? r?.stripMasticDefaultFt ?? 0}
                    onCommit={(v) => upd((d) => (d.termBar.stripMasticLengthFt = v))}
                  />
                </span>
              )}
              <span className="font-medium">Adj. Total Length: {r?.adjTotalLengthFt ?? 0} ft</span>
              <span className="font-medium">Material: {usd(r?.cost ?? 0)}</span>
            </div>
            <FastenerGrid
              slot="termBar"
              keys={EDGE_FASTENER_GROUPS.termBar}
              needed={r?.fastenersNeeded ?? 0}
            />
          </div>
        );
      }
      case "fascia3":
      case "fascia4": {
        const size = screenId === "fascia3" ? "3" : "4";
        const r = result?.fascia[size];
        const f = state.fascia[size];
        const slot: FastenerSlot = screenId;
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              {size === "3" ? '1-3/4" Fascia' : '4" Fascia'}
            </h3>
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
              <span>Roof Edges: {r?.counts.roofEdgesFt ?? 0}</span>
              <span>Parapets: {r?.counts.parapetsFt ?? 0}</span>
              {size === "3" && <span>Curbs: {(r?.counts.curbsFt ?? 0).toLocaleString()}</span>}
            </div>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1" />
                  <th className="border bg-muted px-2 py-1">No Drill</th>
                  <th className="border bg-muted px-2 py-1">Pre-Drill</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border px-2 py-0.5">Calculated Total (ft)</td>
                  <td className="border px-1 py-0.5 text-right">
                    <RO v={r?.noDrillFt ?? 0} />
                  </td>
                  <td className="border px-1 py-0.5 text-right">
                    <RO v={r?.preDrillFt ?? 0} />
                  </td>
                </tr>
                <tr>
                  <td className="border px-2 py-0.5">Additional Required (ft)</td>
                  <td className="border px-1 py-0.5">
                    <Num
                      value={f.additionalNoDrillFt}
                      onCommit={(v) => upd((d) => (d.fascia[size].additionalNoDrillFt = v))}
                    />
                  </td>
                  <td className="border px-1 py-0.5">
                    <Num
                      value={f.additionalPreDrillFt}
                      onCommit={(v) => upd((d) => (d.fascia[size].additionalPreDrillFt = v))}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 rounded border p-2">
                <label className="flex items-center gap-1 text-xs font-medium">
                  <Checkbox
                    checked={f.vinylCovers.on}
                    onCheckedChange={(v) =>
                      upd((d) => (d.fascia[size].vinylCovers.on = v === true))
                    }
                  />
                  Vinyl Covers <span className="font-normal">(Additional added as White)</span>
                </label>
                {f.vinylCovers.on &&
                  TERM_COLORS.map((c) => (
                    <div key={c} className="flex items-center gap-2 text-xs">
                      <span className="w-12">{c}</span>
                      <Num
                        value={f.vinylCovers.qty[c] ?? r?.vinylPrefill[c] ?? 0}
                        onCommit={(v) => upd((d) => (d.fascia[size].vinylCovers.qty[c] = v))}
                      />
                    </div>
                  ))}
              </div>
              <div className="space-y-1 rounded border p-2">
                <label className="flex items-center gap-1 text-xs font-medium">
                  <Checkbox
                    checked={f.metalCovers.on}
                    onCheckedChange={(v) =>
                      upd((d) => (d.fascia[size].metalCovers.on = v === true))
                    }
                  />
                  Metal Cover
                </label>
                {f.metalCovers.on && (
                  <>
                    {TERM_COLORS.map((c) => (
                      <div key={c} className="flex items-center gap-2 text-xs">
                        <span className="w-12">{c}</span>
                        <Num
                          value={
                            f.metalCovers.qty[c] ??
                            (c === "White" ? (r?.metalPrefillWhite ?? 0) : 0)
                          }
                          onCommit={(v) => upd((d) => (d.fascia[size].metalCovers.qty[c] = v))}
                        />
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-24">Inside Corners</span>
                      <Num
                        value={f.metalCovers.inside}
                        onCommit={(v) => upd((d) => (d.fascia[size].metalCovers.inside = v))}
                      />
                      <span className="w-24">Outside Corners</span>
                      <Num
                        value={f.metalCovers.outside}
                        onCommit={(v) => upd((d) => (d.fascia[size].metalCovers.outside = v))}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-1">
                <Checkbox
                  checked={f.stripMastic}
                  onCheckedChange={(v) => upd((d) => (d.fascia[size].stripMastic = v === true))}
                />
                Use Strip Mastic
              </label>
              <LaborLink
                label="No-drill labor:"
                hours={r?.billedHours ?? 0}
                pct={f.adjustNoDrillPct}
                onPct={(v) => upd((d) => (d.fascia[size].adjustNoDrillPct = v))}
              />
              <span className="font-medium">Adj. Total Length: {r?.totalLengthFt ?? 0} ft</span>
              <span className="font-medium">Material: {usd(r?.cost ?? 0)}</span>
            </div>
            <FastenerGrid
              slot={slot}
              keys={EDGE_FASTENER_GROUPS[slot]}
              needed={r?.fastenersNeeded ?? 0}
            />
          </div>
        );
      }
      case "gravelStop":
      case "dripEdge": {
        const group = screenId;
        const gr = result?.[group];
        const isGravel = group === "gravelStop";
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{isGravel ? "Gravel Stops" : "Drip Edges"}</h3>
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
              <span>Roof Edges: {gr?.counts.roofEdgesFt ?? 0}</span>
              <span>Parapets: {gr?.counts.parapetsFt ?? 0}</span>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {(["2", "4"] as const).map((size) => {
                const st = state[group][size];
                const rs = gr?.sizes[size];
                return (
                  <div key={size} className="space-y-1 rounded border p-2">
                    <p className="text-xs font-semibold">
                      {size}" ({rs?.adjTotalLengthFt ?? 0} ft)
                    </p>
                    <table className="text-xs">
                      <thead>
                        <tr>
                          <th className="border bg-muted px-2 py-1 text-left">Color</th>
                          <th className="border bg-muted px-2 py-1">Calculated (ft)</th>
                          <th className="border bg-muted px-2 py-1">Additional (ft)</th>
                          <th className="border bg-muted px-2 py-1">Corners</th>
                          {isGravel && <th className="border bg-muted px-2 py-1">Cover</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {TERM_COLORS.map((c) => (
                          <tr key={c}>
                            <td className="border px-2 py-0.5">{c}</td>
                            <td className="border px-1 py-0.5 text-right">
                              <RO v={rs?.calcByColor[c] ?? 0} w="w-16" />
                            </td>
                            <td className="border px-1 py-0.5">
                              <Num
                                w="w-16"
                                value={st.extraFt[c] ?? 0}
                                onCommit={(v) => upd((d) => (d[group][size].extraFt[c] = v))}
                              />
                            </td>
                            <td className="border px-1 py-0.5">
                              <Num
                                w="w-14"
                                value={st.corners[c] ?? 0}
                                onCommit={(v) => upd((d) => (d[group][size].corners[c] = v))}
                              />
                            </td>
                            {isGravel && (
                              <td className="border px-1 py-0.5">
                                <Num
                                  w="w-14"
                                  value={st.coverQty?.[c] ?? 0}
                                  onCommit={(v) =>
                                    upd((d) => {
                                      (d[group][size].coverQty ??= {})[c] = v;
                                    })
                                  }
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {isGravel && (
                      <div className="flex items-center gap-2 text-xs">
                        <span>Inside Corners</span>
                        <Num
                          w="w-14"
                          value={st.insideCorners ?? 0}
                          onCommit={(v) => upd((d) => (d[group][size].insideCorners = v))}
                        />
                        <span>Outside Corners</span>
                        <Num
                          w="w-14"
                          value={st.outsideCorners ?? 0}
                          onCommit={(v) => upd((d) => (d[group][size].outsideCorners = v))}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-3 text-xs">
                      <LaborLink
                        label="Labor:"
                        hours={rs?.hours ?? 0}
                        pct={st.adjustPct}
                        onPct={(v) => upd((d) => (d[group][size].adjustPct = v))}
                      />
                      <span>Material: {usd(rs?.cost ?? 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <FastenerGrid
              slot={group}
              keys={EDGE_FASTENER_GROUPS[group]}
              needed={gr?.fastenersNeeded ?? 0}
            />
          </div>
        );
      }
      case "snapCover": {
        const selSize = snapSize;
        const setSel = setSnapSize;
        const rs = result?.snapCover.sizes[selSize];
        const counts = result?.snapCover.countsBySize[selSize];
        const st = state.snapCover[selSize];
        const priced = refData.twoPiece[selSize]?.priced;
        return (
          <div className="space-y-3">
            <h3 className="text-center text-lg font-semibold">Base Metal &amp; Snap Cover</h3>
            <div className="flex flex-wrap gap-1">
              {SNAP_SIZES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === selSize ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setSel(s)}
                >
                  {s}" Piece ({result?.snapCover.sizes[s]?.totalLengthFt ?? 0} ft)
                </Button>
              ))}
            </div>
            {!priced && (
              <p className="text-xs text-amber-600">
                Two-Piece Metal prices are not captured yet (docs §12.7) — footage bills labor only
                until the admin grid is photographed.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
              <span>Roof Edges: {counts?.roofEdgesFt ?? 0}</span>
              <span>Parapets: {counts?.parapetsFt ?? 0}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>Calculated Total:</span>
              <RO v={rs?.calcFt ?? 0} w="w-16" />
              <span>Additional Required:</span>
              <Num
                w="w-16"
                value={st.additionalFt}
                onCommit={(v) => upd((d) => (d.snapCover[selSize].additionalFt = v))}
              />
            </div>
            <div className="space-y-1 rounded border p-2">
              <p className="text-xs font-semibold">Metal Snap Cover</p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <Checkbox
                    checked={st.coversOn}
                    onCheckedChange={(v) =>
                      upd((d) => (d.snapCover[selSize].coversOn = v === true))
                    }
                  />
                  Cover:
                </label>
                <Num
                  w="w-16"
                  disabled={!st.coversOn}
                  value={st.coversQty ?? rs?.totalLengthFt ?? 0}
                  onCommit={(v) => upd((d) => (d.snapCover[selSize].coversQty = v))}
                />
                <span>Inside:</span>
                <Num
                  w="w-14"
                  value={st.insideCorners}
                  onCommit={(v) => upd((d) => (d.snapCover[selSize].insideCorners = v))}
                />
                <span>Outside:</span>
                <Num
                  w="w-14"
                  value={st.outsideCorners}
                  onCommit={(v) => upd((d) => (d.snapCover[selSize].outsideCorners = v))}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <LaborLink
                label="Labor:"
                hours={rs?.hours ?? 0}
                pct={st.adjustPct}
                onPct={(v) => upd((d) => (d.snapCover[selSize].adjustPct = v))}
              />
              <span className="font-medium">Adj. Total Length: {rs?.totalLengthFt ?? 0} ft</span>
            </div>
            <FastenerGrid
              slot="snapCover"
              keys={EDGE_FASTENER_GROUPS.snapCover}
              title="Compression or Snap Cover"
              needed={result?.snapCover.fastenersNeeded ?? 0}
            />
          </div>
        );
      }

      /* ---------------- Calculated Items ---------------- */
      case "panduit": {
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Panduit</h3>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Panduits</th>
                  <th className="border bg-muted px-2 py-1">Qty</th>
                  <th className="border bg-muted px-2 py-1">Extra</th>
                  <th className="border bg-muted px-2 py-1">Boxes</th>
                </tr>
              </thead>
              <tbody>
                {refData.panduit.map((row) => (
                  <tr key={row.description}>
                    <td className="border px-2 py-0.5">{row.description}</td>
                    <td className="border px-1 py-0.5 text-right">
                      <RO v={result?.panduit.calcByLength[row.description] ?? 0} w="w-14" />
                    </td>
                    <td className="border px-1 py-0.5">
                      <Num
                        w="w-14"
                        value={state.panduitExtra[row.description] ?? 0}
                        onCommit={(v) => upd((d) => (d.panduitExtra[row.description] = v))}
                      />
                    </td>
                    <td className="border px-1 py-0.5 text-right">
                      <RO v={result?.panduit.boxesByRow[row.description] ?? 0} w="w-14" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              Material: {usd(result?.panduit.cost ?? 0)}
            </p>
          </div>
        );
      }
      case "sealants": {
        const DISCONTINUED = new Set([
          "1116",
          "1116B",
          "1114",
          "1115",
          "1126",
          "1126B",
          "1124",
          "1125",
        ]);
        const discCount = refData.sealants
          .filter((s) => DISCONTINUED.has(s.part))
          .reduce((sum, s) => sum + (state.sealants.extra[s.part] ?? 0), 0);
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <Checkbox
                  checked={state.sealants.showDiscontinued}
                  onCheckedChange={(v) => upd((d) => (d.sealants.showDiscontinued = v === true))}
                />
                Show Discontinued Sealants
              </label>
              <span># Discontinued Sealants: {discCount}</span>
            </div>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Description</th>
                  <th className="border bg-muted px-2 py-1">Part #</th>
                  <th className="border bg-muted px-2 py-1">Calc Qty</th>
                  <th className="border bg-muted px-2 py-1">Extra</th>
                </tr>
              </thead>
              <tbody>
                {refData.sealants
                  .filter((s) => state.sealants.showDiscontinued || !DISCONTINUED.has(s.part))
                  .map((s) => (
                    <tr key={s.part} className={DISCONTINUED.has(s.part) ? "text-red-600" : ""}>
                      <td className="border px-2 py-0.5">
                        {s.description}
                        {DISCONTINUED.has(s.part) && (
                          <span className="ml-1 text-[10px]">(use Duro-Caulk Plus)</span>
                        )}
                      </td>
                      <td className="border px-2 py-0.5">{s.part}</td>
                      <td className="border px-1 py-0.5 text-right">
                        <RO v={result?.sealants.calcByPart[s.part] ?? 0} w="w-14" />
                      </td>
                      <td className="border px-1 py-0.5">
                        <Num
                          w="w-14"
                          value={state.sealants.extra[s.part] ?? 0}
                          onCommit={(v) => upd((d) => (d.sealants.extra[s.part] = v))}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              Material: {usd(result?.sealants.cost ?? 0)} — pitch-pocket filler CalcQty awaits the
              RefID→part mapping (docs §12.8).
            </p>
          </div>
        );
      }
      case "adhesives": {
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Adhesives</h3>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Description</th>
                  <th className="border bg-muted px-2 py-1">Calc Qty</th>
                  <th className="border bg-muted px-2 py-1">Extra</th>
                </tr>
              </thead>
              <tbody>
                {props.adhesiveNames.map((name) => (
                  <tr key={name}>
                    <td className="border px-2 py-0.5">{name}</td>
                    <td className="border px-1 py-0.5 text-right">
                      <RO v={props.adhesiveCalc?.[name] ?? 0} w="w-14" />
                    </td>
                    <td className="border px-1 py-0.5">
                      <Num
                        w="w-14"
                        value={state.adhesivesExtra[name] ?? 0}
                        onCommit={(v) => upd((d) => (d.adhesivesExtra[name] = v))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              Calc Qty is the §2.4 whole-unit aggregate (membrane + layers + walls, ceilinged once
              per adhesive); each adhesive's cost rounds to whole dollars (§12.4).
            </p>
          </div>
        );
      }
      case "membraneAccs": {
        const ma = state.membraneAccs;
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Membrane Accessories</h3>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Description</th>
                  <th className="border bg-muted px-2 py-1">Calc Qty</th>
                  <th className="border bg-muted px-2 py-1">Extra</th>
                  <th className="border bg-muted px-2 py-1">Labor</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border px-2 py-0.5">ARP (SqFt)</td>
                  <td className="border px-1 py-0.5 text-right">
                    <RO v={props.arpCalcQty} w="w-14" />
                  </td>
                  <td className="border px-1 py-0.5">
                    <Num
                      w="w-14"
                      value={ma.arpExtra}
                      onCommit={(v) => upd((d) => (d.membraneAccs.arpExtra = v))}
                    />
                  </td>
                  <td className="border px-2 py-0.5 text-right">0 h</td>
                </tr>
                <tr>
                  <td className="border px-2 py-0.5">
                    T-Patch{" "}
                    <span className="text-[10px] text-muted-foreground">
                      (auto calc pending extraction — docs §12.8)
                    </span>
                  </td>
                  <td className="border px-1 py-0.5 text-right">
                    <RO v={result?.membraneAccs.tPatchCalc ?? 0} w="w-14" />
                  </td>
                  <td className="border px-1 py-0.5">
                    <Num
                      w="w-14"
                      value={ma.tPatchExtra}
                      onCommit={(v) => upd((d) => (d.membraneAccs.tPatchExtra = v))}
                    />
                  </td>
                  <td className="border px-2 py-0.5">
                    <LaborLink
                      hours={(ma.tPatchExtra || 0) * (refData.membraneAccs.tPatchHours || 0)}
                      pct={ma.tPatchAdjustPct}
                      onPct={(v) => upd((d) => (d.membraneAccs.tPatchAdjustPct = v))}
                    />
                  </td>
                </tr>
                {props.sections.map((s) => (
                  <tr key={s.id}>
                    <td className="border px-2 py-0.5">
                      1' of 10" DL {s.color} Stripping — {s.name}
                      <span className="ml-1 text-[10px] text-amber-600">
                        (price uncaptured — labor only)
                      </span>
                    </td>
                    <td className="border px-1 py-0.5 text-right">
                      <RO v={0} w="w-14" />
                    </td>
                    <td className="border px-1 py-0.5">
                      <Num
                        w="w-14"
                        value={ma.strippingFtBySection[s.id] ?? 0}
                        onCommit={(v) =>
                          upd((d) => (d.membraneAccs.strippingFtBySection[s.id] = v))
                        }
                      />
                    </td>
                    <td className="border px-2 py-0.5 text-right">
                      {hrs2(
                        (ma.strippingFtBySection[s.id] ?? 0) *
                          (refData.membraneAccs.strippingHoursPerFt || 0),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              Material: {usd(result?.membraneAccs.cost ?? 0)}
            </p>
          </div>
        );
      }
      case "vents": {
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Vents</h3>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="border bg-muted px-2 py-1 text-left">Vents</th>
                  <th className="border bg-muted px-2 py-1">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {refData.vents.map((v) => {
                  const calc = result?.vents.calcByColor[v.color.replace(/ Vent$/, "")] ?? 0;
                  const total = Math.max(0, calc + (state.vents.delta[v.color] ?? 0));
                  return (
                    <tr key={v.color}>
                      <td className="border px-2 py-0.5">{v.color}</td>
                      <td className="border px-1 py-0.5">
                        <Num
                          w="w-16"
                          value={total}
                          onCommit={(x) => upd((d) => (d.vents.delta[v.color] = x - calc))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <LaborLink
              label="Labor:"
              hours={result?.vents.hours ?? 0}
              pct={state.vents.adjustPct}
              onPct={(v) => upd((d) => (d.vents.adjustPct = v))}
            />
            <p className="text-xs text-muted-foreground">
              Derived: 1 vent per 1,000 sq ft of mechanically-attached section, by section colour
              (§12.4). Edit the quantity to add or remove vents.
            </p>
          </div>
        );
      }

      /* ---------------- Fasteners & Related ---------------- */
      case "parapetTabs": {
        return (
          <div className="space-y-3">
            <p
              className={`text-xs font-medium ${(result?.parapetTabs.fastenersNeeded ?? 0) > 0 ? "text-red-600" : ""}`}
            >
              Fasteners Needed: {result?.parapetTabs.fastenersNeeded ?? 0}
            </p>
            <div className="flex flex-wrap gap-8">
              <FastenerGrid
                slot="parapet"
                keys={EDGE_FASTENER_GROUPS.parapet.filter((k) => k !== PLATE_ROWS.steel)}
                title="Parapet Wall-Tab Fasteners"
              />
              <SubtypeColumn
                slot="parapet"
                subtypes={["Bit-SDS", "Bit-Straight", "Bit-TE-CX"]}
                title="Masonry Bits"
              />
              <div className="space-y-2">
                <p
                  className={`text-xs font-medium ${(result?.parapetTabs.steelPlatesNeeded ?? 0) > 0 ? "text-red-600" : ""}`}
                >
                  Steel Plates Needed: {result?.parapetTabs.steelPlatesNeeded ?? 0}
                </p>
                <FastenerGrid slot="parapet" keys={[PLATE_ROWS.steel]} title="Steel Plates" />
              </div>
            </div>
          </div>
        );
      }
      case "wood":
      case "metal":
      case "gypsum":
      case "concrete":
      case "lwConcrete":
      case "lwSteel": {
        const bucket = screenId;
        const needs = result?.deckNeeds[bucket];
        const cols: Array<{ subtypes: string[]; title: string }> = (() => {
          switch (bucket) {
            case "wood":
              return [
                { subtypes: ["Spade"], title: "Spade Point w/ Phillips Drive" },
                { subtypes: ["Drill Point"], title: "Drill Point" },
                { subtypes: ["XHD"], title: "Extra Heavy Duty #15" },
              ];
            case "metal":
              return [
                { subtypes: ["Spade"], title: "Spade Point w/ Phillips Drive" },
                { subtypes: ["Drill Point"], title: "Drill Point" },
                { subtypes: ["Purlin"], title: "Purlin Fasteners" },
                { subtypes: ["XHD"], title: "Extra Heavy Duty #15" },
              ];
            case "gypsum":
              return [
                { subtypes: ["Auger"], title: "Auger Fasteners with Plate" },
                { subtypes: ["NTB"], title: "NTB Fasteners" },
                { subtypes: ["Bit-SDS", "Bit-Straight"], title: "Masonry Bits" },
              ];
            case "concrete":
              return [
                { subtypes: ["Nail"], title: "Concrete Fasteners" },
                { subtypes: ["Concrete Screw"], title: "Concrete Screws" },
                { subtypes: ["Bit-SDS", "Bit-Straight", "Bit-TE-CX"], title: "Masonry Bits" },
              ];
            case "lwConcrete":
              return [
                { subtypes: ["Nail"], title: "Concrete Fasteners" },
                { subtypes: ["Auger"], title: "Auger Fastner w/ Plate" },
                { subtypes: ["Concrete Screw"], title: "Concrete Screws" },
                { subtypes: ["NTB"], title: "NTB Fasteners" },
                { subtypes: ["Bit-SDS", "Bit-Straight", "Bit-TE-CX"], title: "Masonry Bits" },
              ];
            case "lwSteel":
              return [
                { subtypes: ["Spade"], title: "Spade Point w/ Phillips Drive" },
                { subtypes: ["Drill Point"], title: "Drill Point" },
                { subtypes: ["Purlin"], title: "Purlin Fasteners" },
                { subtypes: ["XHD"], title: "Extra Heavy Duty #15" },
                { subtypes: ["Bit-SDS", "Bit-Straight"], title: "Masonry Bits" },
              ];
          }
        })();
        return (
          <div className="space-y-3">
            <p className="text-center text-xs font-semibold">Items Required</p>
            <div className="flex flex-wrap justify-center gap-6 text-xs font-medium">
              <span className={(needs?.fasteners ?? 0) > 0 ? "text-red-600" : "text-green-700"}>
                Fasteners: {needs?.fasteners ?? 0}
              </span>
              <span className={(needs?.polyPlates ?? 0) > 0 ? "text-red-600" : "text-green-700"}>
                Poly Plates: {needs?.polyPlates ?? 0}
              </span>
              <span className={(needs?.insulPlates ?? 0) > 0 ? "text-red-600" : "text-green-700"}>
                Insul. Plates: {needs?.insulPlates ?? 0}
              </span>
              <span
                className={(needs?.inductionPlates ?? 0) > 0 ? "text-red-600" : "text-green-700"}
              >
                Induction Plates: {needs?.inductionPlates ?? 0}
              </span>
            </div>
            <div className="flex flex-wrap gap-6">
              {cols.map((c) => (
                <SubtypeColumn key={c.title} slot={bucket} subtypes={c.subtypes} title={c.title} />
              ))}
              <SubtypeColumn slot={bucket} subtypes={["DL-Plates"]} title="Plates" />
              <SubtypeColumn slot={bucket} subtypes={["SD-Tips"]} title="Driver Tips" />
            </div>
          </div>
        );
      }
    }
  })();

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="space-y-2 rounded border p-2 text-xs">
        {TREE.map((group) => (
          <div key={group.label}>
            <p className="font-semibold">{group.label}</p>
            <ul className="ml-3 space-y-0.5">
              {group.items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    title={
                      screenNeedsAttention.has(it.id)
                        ? "This screen still has needed quantities — open it to cover them."
                        : undefined
                    }
                    className={`w-full rounded px-1 py-0.5 text-left ${
                      screenId === it.id
                        ? "bg-primary text-primary-foreground"
                        : screenNeedsAttention.has(it.id)
                          ? "font-medium text-red-600 hover:bg-muted dark:text-red-400"
                          : "hover:bg-muted"
                    }`}
                    onClick={() => setScreenId(it.id)}
                  >
                    {it.label}
                    {screenNeedsAttention.has(it.id) && screenId === it.id ? " •" : ""}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="min-w-0 rounded border p-3">{screen}</div>
    </div>
  );
}
