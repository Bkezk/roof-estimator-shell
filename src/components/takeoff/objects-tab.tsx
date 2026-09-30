/**
 * Objects tab — every drawn object grouped by kind, and the editor for the selected one: an
 * area's per-side edge table and cut-outs, a linear's role (and parapet height), a count's role
 * and sizes. Number boxes stay blank when 0 (placeholder 0); nothing is prefilled.
 *
 * While "Edge from this area" is on, its panel takes the top of the tab instead of the selected
 * object's card (owner, Sep 30: "the pop-up is easy to miss"): one row per side — its letter,
 * length and a role Select (the linear roles, or Leave out) — a live summary of what Create
 * makes, and big Create / Cancel buttons. The session is the editor's, shared with the viewer.
 */
import { useEffect, useRef } from "react";
import { AlertTriangle, Copy, SquareDashed, Trash2 } from "lucide-react";

import { ARP_SIZE_OPTIONS, TERMINATION_OPTIONS } from "@/lib/engine/edges";
import {
  drawnSideLabels,
  edgeLengths,
  polygonArea,
  type OutlineEdgeOptions,
} from "@/lib/takeoff/geometry";
import {
  COUNT_ROLES,
  COUNT_ROLE_LABELS,
  LINEAR_ROLES,
  LINEAR_ROLE_LABELS,
  feetPerPx,
  slopeFactor,
  slopeFactorLabel,
  type CountRole,
  type LinearRole,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffQuantities,
  type TakeoffSetup,
} from "@/lib/takeoff/model";
import { Button } from "@/components/ui/button";
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

import { pointerCloseAutoFocus } from "./focus";
import { DrainFields } from "./drain-fields";
import { Tip } from "./toolbar";
import {
  COUNT_BASE_NAMES,
  COUNT_ROLE_HINTS,
  LEAVE_OUT_HINT,
  LEFT_OUT_COLOR,
  LINEAR_BASE_NAMES,
  LINEAR_ROLE_COLORS,
  LINEAR_ROLE_HINTS,
  drainDefaults,
  defaultEdgeOptions,
  edgeLengthsFt,
  edgeSideRoles,
  edgeSummary,
  fmtFt,
  fmtNum,
  fmtSqFt,
  isDefaultName,
  lengthLabel,
  netAreaSqFt,
  polylineLengthPx,
  setEdgeSide,
  uniqueName,
  withDrainPick,
  withoutDrainPicks,
  type EdgeSession,
} from "./shapes";

type Update = (id: string, fn: (o: TakeoffObject) => TakeoffObject) => void;

export interface ObjectsTabProps {
  objects: readonly TakeoffObject[];
  pages: readonly TakeoffPage[];
  quantities: TakeoffQuantities;
  /** The takeoff's setup: a count switched to Drain takes its drain defaults. */
  setup: TakeoffSetup;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: Update;
  onDelete: (id: string) => void;
  /** "Edge from this area": make linears along the selected area's sides (in the viewer). */
  onEdgeFromArea?: (areaId: string) => void;
  /** "Duplicate and stamp": copies of the selected object follow the cursor (in the viewer). */
  onDuplicate?: (objectId: string) => void;
  /** "Edge from this area" while it is on: its panel replaces the selected object's card. */
  edge?: EdgeSession | null;
  onEdgeChange?: (edge: EdgeSession | null) => void;
  onEdgeCreate?: () => void;
}

const KIND_TITLES = { area: "Areas", linear: "Linears", count: "Counts" } as const;

export function ObjectsTab(props: ObjectsTabProps) {
  const { objects, pages, quantities } = props;
  const unscaled = new Set(quantities.unscaled.map((u) => u.objectId));
  const pageOf = (i: number) => pages.find((p) => p.index === i);
  const selected = objects.find((o) => o.id === props.selectedId) ?? null;
  const edge = props.edge ?? null;
  const edgeArea = edge
    ? objects.find((o) => o.id === edge.areaId && o.kind === "area")
    : undefined;

  const summary = (o: TakeoffObject): string => {
    const fpp = feetPerPx(pageOf(o.page)?.scale);
    if (o.kind === "count") return `qty ${Math.max(1, o.points.length)}`;
    if (fpp === null) return "";
    if (o.kind === "area")
      return fmtSqFt(
        (netAreaSqFt(o.points, o.attrs.cutouts, fpp) ?? 0) * slopeFactor(o.attrs.pitch),
      );
    return fmtFt(polylineLengthPx(o.points) * fpp);
  };

  return (
    <div className="space-y-4">
      {edge && edgeArea?.kind === "area" ? (
        <EdgePanel
          area={edgeArea}
          page={pageOf(edgeArea.page)}
          edge={edge}
          onChange={(e) => props.onEdgeChange?.(e)}
          onCreate={() => props.onEdgeCreate?.()}
          onCancel={() => props.onEdgeChange?.(null)}
        />
      ) : selected ? (
        <SelectedEditor
          key={selected.id}
          object={selected}
          page={pageOf(selected.page)}
          objects={objects}
          setup={props.setup}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
          onDuplicate={props.onDuplicate}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Draw with Area, Linear or Count, or click an object (Select tool) to edit it here.
        </p>
      )}
      {!edgeArea && selected?.kind === "area" && props.onEdgeFromArea && (
        <Tip
          name="Edge from this area"
          text="turn the area's sides into parapet, gutter or other lines, a role per side"
        >
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full gap-1"
            onClick={(e) => {
              props.onEdgeFromArea?.(selected.id);
              // Mouse click: hand the keys back to the drawing (Enter, Esc, role keys).
              if (e.detail > 0) e.currentTarget.blur();
            }}
          >
            <SquareDashed className="h-4 w-4" /> Edge from this area
          </Button>
        </Tip>
      )}

      {(["area", "linear", "count"] as const).map((kind) => {
        const list = objects.filter((o) => o.kind === kind);
        return (
          <section key={kind} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {KIND_TITLES[kind]} ({list.length})
            </h3>
            {list.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
            {list.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={(e) => {
                  props.onSelect(o.id);
                  // Mouse click: hand the keys back to the drawing (Delete, tool keys…).
                  if (e.detail > 0) e.currentTarget.blur();
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                  o.id === props.selectedId ? "bg-primary/10 ring-1 ring-primary/40" : ""
                }`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: o.color ?? "#2563eb" }}
                />
                <span className="min-w-0 flex-1 truncate">{o.attrs.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {pageOf(o.page)?.name ?? `Page ${o.page + 1}`}
                </span>
                {unscaled.has(o.id) ? (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
                    no scale on this page
                  </span>
                ) : (
                  <span className="shrink-0 text-xs tabular-nums">{summary(o)}</span>
                )}
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Num(props: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  className?: string;
}) {
  return (
    <NumberField
      className={props.className ?? "h-8"}
      step="any"
      inputMode="decimal"
      value={props.value ?? 0}
      onChange={(v) => props.onChange(v > 0 ? v : undefined)}
    />
  );
}

/** Set or clear one optional attribute without writing `undefined` into the saved JSON. */
function withAttr<T extends object, K extends keyof T>(attrs: T, k: K, v: T[K] | undefined): T {
  const nx = { ...attrs };
  if (v === undefined) delete nx[k];
  else nx[k] = v;
  return nx;
}

function SelectedEditor(props: {
  object: TakeoffObject;
  page: TakeoffPage | undefined;
  objects: readonly TakeoffObject[];
  setup: TakeoffSetup;
  onUpdate: Update;
  onDelete: (id: string) => void;
  onDuplicate?: ((id: string) => void) | undefined;
}) {
  const o = props.object;
  const fpp = feetPerPx(props.page?.scale);
  const update = (fn: (o: TakeoffObject) => TakeoffObject) => props.onUpdate(o.id, fn);
  const setName = (name: string) =>
    update((x) => ({ ...x, attrs: { ...x.attrs, name } }) as TakeoffObject);

  return (
    <section className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: o.color ?? "#2563eb" }}
        />
        <Input
          className="h-8 flex-1"
          value={o.attrs.name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Name"
        />
        {props.onDuplicate && (
          <Tip name="Duplicate" text="stamp copies of this shape on the drawing (Ctrl+D)">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Duplicate object"
              onClick={(e) => {
                props.onDuplicate?.(o.id);
                // Mouse click: hand the keys back to the drawing (Esc stops stamping).
                if (e.detail > 0) e.currentTarget.blur();
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </Tip>
        )}
        <Tip name="Delete" text="remove this shape (Delete; Ctrl+Z brings it back)">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive"
            onClick={() => props.onDelete(o.id)}
            aria-label="Delete object"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </Tip>
      </div>
      {fpp === null && o.kind !== "count" && (
        <p className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
          No scale on this page — set one with the Scale tool to get real sizes.
        </p>
      )}
      {o.kind === "area" && <AreaEditor object={o} fpp={fpp} setup={props.setup} update={update} />}
      {o.kind === "linear" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Role</Label>
            <Select
              value={o.attrs.role}
              onValueChange={(v) =>
                update((x) => {
                  if (x.kind !== "linear") return x;
                  const role = v as LinearRole;
                  const rename = isDefaultName(x.attrs.name, LINEAR_BASE_NAMES[x.attrs.role]);
                  const others = props.objects.filter((y) => y.id !== x.id);
                  let attrs = { ...x.attrs, role };
                  if (rename) attrs.name = uniqueName(LINEAR_BASE_NAMES[role], others);
                  if (role !== "parapet") attrs = withAttr(attrs, "heightIn", undefined);
                  return { ...x, attrs };
                })
              }
            >
              <Tip name={LINEAR_ROLE_LABELS[o.attrs.role]} text={LINEAR_ROLE_HINTS[o.attrs.role]}>
                <SelectTrigger className="h-8" aria-label="Line role">
                  <SelectValue />
                </SelectTrigger>
              </Tip>
              <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
                {LINEAR_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {LINEAR_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Length</Label>
            <p className="flex h-8 items-center text-sm tabular-nums">
              {fpp === null ? "—" : fmtFt(polylineLengthPx(o.points) * fpp)}
            </p>
          </div>
          {o.attrs.role === "parapet" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Height (in)</Label>
              <Num
                value={o.attrs.heightIn}
                onChange={(v) =>
                  update((x) =>
                    x.kind === "linear" ? { ...x, attrs: withAttr(x.attrs, "heightIn", v) } : x,
                  )
                }
              />
            </div>
          )}
        </div>
      )}
      {o.kind === "count" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Role</Label>
            <Select
              value={o.attrs.role}
              onValueChange={(v) =>
                update((x) => {
                  if (x.kind !== "count") return x;
                  const role = v as CountRole;
                  const rename = isDefaultName(x.attrs.name, COUNT_BASE_NAMES[x.attrs.role]);
                  const others = props.objects.filter((y) => y.id !== x.id);
                  let attrs = { ...x.attrs, role };
                  if (rename) attrs.name = uniqueName(COUNT_BASE_NAMES[role], others);
                  if (role !== "curb") {
                    attrs = withAttr(attrs, "widthIn", undefined);
                    attrs = withAttr(attrs, "lengthIn", undefined);
                  }
                  if (role !== "drain") attrs = withoutDrainPicks(attrs);
                  else if (x.attrs.role !== "drain")
                    attrs = { ...attrs, ...drainDefaults(props.setup) };
                  return { ...x, attrs };
                })
              }
            >
              <Tip name={COUNT_ROLE_LABELS[o.attrs.role]} text={COUNT_ROLE_HINTS[o.attrs.role]}>
                <SelectTrigger className="h-8" aria-label="Count role">
                  <SelectValue />
                </SelectTrigger>
              </Tip>
              <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
                {COUNT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {COUNT_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Quantity</Label>
            <div className="flex h-8 items-center gap-2 text-sm tabular-nums">
              {o.points.length}
              {o.points.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => update((x) => ({ ...x, points: x.points.slice(0, -1) }))}
                >
                  Remove last
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Size (in)</Label>
            <Num
              value={o.attrs.sizeIn}
              onChange={(v) =>
                update((x) =>
                  x.kind === "count" ? { ...x, attrs: withAttr(x.attrs, "sizeIn", v) } : x,
                )
              }
            />
          </div>
          {o.attrs.role === "drain" && (
            <>
              <DrainFields
                idPrefix={`drain-${o.id}`}
                value={o.attrs}
                onChange={(k, v) =>
                  update((x) =>
                    x.kind === "count" ? { ...x, attrs: withDrainPick(x.attrs, k, v) } : x,
                  )
                }
              />
              {(!o.attrs.bootSize || !o.attrs.ringSize) && (
                <p className="col-span-2 flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Pick a boot and ring so this drain goes into the bid
                </p>
              )}
            </>
          )}
          {o.attrs.role === "curb" && (
            <div className="col-span-2 space-y-1">
              <Label className="text-xs text-muted-foreground">Curb width × length (in)</Label>
              <div className="flex items-center gap-2">
                <Num
                  value={o.attrs.widthIn}
                  onChange={(v) =>
                    update((x) =>
                      x.kind === "count" ? { ...x, attrs: withAttr(x.attrs, "widthIn", v) } : x,
                    )
                  }
                />
                <span className="text-muted-foreground">×</span>
                <Num
                  value={o.attrs.lengthIn}
                  onChange={(v) =>
                    update((x) =>
                      x.kind === "count" ? { ...x, attrs: withAttr(x.attrs, "lengthIn", v) } : x,
                    )
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The role Select's value for a side left out ("Edge from this area"). */
const LEAVE_OUT = "leave_out";

/** A role's colour swatch and name, as the Select shows it (grey and dashed for Leave out). */
function RoleOption(props: { role: LinearRole | null }) {
  const r = props.role;
  return (
    <span className="flex items-center gap-2">
      <span
        className="h-2.5 w-4 shrink-0 rounded-sm"
        style={
          r
            ? { backgroundColor: LINEAR_ROLE_COLORS[r] }
            : { border: `2px dashed ${LEFT_OUT_COLOR}` }
        }
      />
      {r ? LINEAR_ROLE_LABELS[r] : "Leave out"}
    </span>
  );
}

/**
 * "Edge from this area": a role (or Leave out) per side, what Create makes, Create / Cancel.
 * Untouched sides follow the role chips' current role until set here or clicked on the plan.
 */
function EdgePanel(props: {
  area: Extract<TakeoffObject, { kind: "area" }>;
  page: TakeoffPage | undefined;
  edge: EdgeSession;
  onChange: (edge: EdgeSession) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const { area, edge } = props;
  const fpp = feetPerPx(props.page?.scale);
  const n = area.points.length;
  const roles = edgeSideRoles(edge, n);
  const labels = drawnSideLabels(area.points);
  const lens = edgeLengths(area.points);
  const sum = edgeSummary(area.points, roles, fpp);
  const toRole = (v: string): LinearRole | null => (v === LEAVE_OUT ? null : (v as LinearRole));
  const setSide = (i: number, v: string) => props.onChange(setEdgeSide(edge, n, i, toRole(v)));
  const setAll = (v: string) => props.onChange({ ...edge, sides: roles.map(() => toRole(v)) });
  const allValue = common(roles.map((r) => r ?? LEAVE_OUT));
  const hint = (r: LinearRole | null) =>
    r ? `${LINEAR_ROLE_LABELS[r]}: ${LINEAR_ROLE_HINTS[r]}` : `Leave out: ${LEAVE_OUT_HINT}`;
  const options = (
    <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
      {LINEAR_ROLES.map((r) => (
        <SelectItem key={r} value={r}>
          <RoleOption role={r} />
        </SelectItem>
      ))}
      <SelectItem value={LEAVE_OUT}>
        <RoleOption role={null} />
      </SelectItem>
    </SelectContent>
  );
  // Bring the panel into view when the mode starts (the tab may be scrolled down the list).
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [area.id]);
  return (
    <section
      ref={ref}
      className="space-y-3 rounded-md border-2 border-primary bg-primary/5 p-3 shadow-sm"
      aria-label={`Edge from ${area.attrs.name}`}
    >
      <div className="flex items-start gap-2">
        <SquareDashed className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold leading-tight">Edge from {area.attrs.name}</h3>
          <p className="text-xs text-muted-foreground">
            Pick what runs along each side, or Leave out a side (a side shared with another roof).
            Clicking a side on the plan cycles it; the role chips (keys 1–5) set the role of sides
            not set here.
          </p>
        </div>
      </div>
      {fpp === null && (
        <p className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
          No scale on this page — lengths are in px until you set one with the Scale tool.
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="py-1 pr-2 font-medium">Side</th>
            <th className="pr-2 font-medium">Length</th>
            <th className="font-medium">Role</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t bg-muted/40">
            <td className="py-1.5 pr-2 font-semibold" colSpan={2}>
              All sides
            </td>
            <td>
              <Select value={allValue ?? ""} onValueChange={setAll}>
                <Tip name="All sides" text="give every side the same role, or leave them all out">
                  <SelectTrigger className="h-8 w-full" aria-label="Role of all sides">
                    <SelectValue placeholder="Mixed" />
                  </SelectTrigger>
                </Tip>
                {options}
              </Select>
            </td>
          </tr>
          {roles.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="py-1.5 pr-2 font-semibold">{labels[i]}</td>
              <td className="whitespace-nowrap pr-2 tabular-nums">{lengthLabel(lens[i]!, fpp)}</td>
              <td>
                <Select value={r ?? LEAVE_OUT} onValueChange={(v) => setSide(i, v)}>
                  <Tip name={`Side ${labels[i]}`} text={hint(r)}>
                    <SelectTrigger className="h-8 w-full" aria-label={`Side ${labels[i]} role`}>
                      <SelectValue />
                    </SelectTrigger>
                  </Tip>
                  {options}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p
        className="rounded border bg-background px-2 py-1.5 text-sm font-medium"
        aria-live="polite"
      >
        {sum.text}
      </p>
      <div className="flex gap-2">
        <Tip
          name="Create"
          wrap={!sum.lines}
          wrapClassName="flex flex-1"
          text="make one line per run of sides with the same role (Enter or right-click on the plan)"
        >
          <Button
            className="h-10 flex-1 text-base"
            disabled={!sum.lines}
            onClick={(e) => {
              props.onCreate();
              if (e.detail > 0) e.currentTarget.blur();
            }}
          >
            Create {sum.lines > 0 ? `${sum.lines} line${sum.lines === 1 ? "" : "s"}` : ""}
          </Button>
        </Tip>
        <Tip name="Cancel" text="leave without making any lines (Esc)">
          <Button
            variant="outline"
            className="h-10 flex-1 text-base"
            onClick={(e) => {
              props.onCancel();
              if (e.detail > 0) e.currentTarget.blur();
            }}
          >
            Cancel
          </Button>
        </Tip>
      </div>
    </section>
  );
}

/** One value when every side agrees, else undefined ("Mixed"). */
function common<T>(xs: readonly T[]): T | undefined {
  return xs.length && xs.every((x) => x === xs[0]) ? xs[0] : undefined;
}
/** A checkbox state over all sides: on, off, or mixed. */
const triState = (xs: readonly boolean[]): boolean | "indeterminate" =>
  xs.every(Boolean) ? true : xs.some(Boolean) ? "indeterminate" : false;

function AreaEditor(props: {
  object: Extract<TakeoffObject, { kind: "area" }>;
  fpp: number | null;
  setup: TakeoffSetup;
  update: (fn: (o: TakeoffObject) => TakeoffObject) => void;
}) {
  const o = props.object;
  const { fpp } = props;
  const lens = edgeLengthsFt(o.points, fpp);
  // Side labels as the drawing and the bid show them (A–D on a four-sided outline, else 1..N).
  const sideLabels = drawnSideLabels(o.points);
  const edges: OutlineEdgeOptions[] = o.points.map((_, i) => o.attrs.edges?.[i] ?? {});
  const cutouts = o.attrs.cutouts ?? [];
  const net = netAreaSqFt(o.points, cutouts, fpp);
  // A pitched roof: the drawing is the plan, the roof surface is plan × the slope factor.
  const factor = slopeFactor(o.attrs.pitch);

  const setEdge = <K extends keyof OutlineEdgeOptions>(
    i: number,
    k: K,
    v: OutlineEdgeOptions[K] | undefined,
  ) =>
    props.update((x) => {
      if (x.kind !== "area") return x;
      const cur: OutlineEdgeOptions[] = x.points.map((_, j) => x.attrs.edges?.[j] ?? {});
      cur[i] = withAttr(cur[i]!, k, v);
      return { ...x, attrs: { ...x.attrs, edges: cur } };
    });
  // "All sides": one change applied to every side (value per side, e.g. blocking = its length).
  const setAll = <K extends keyof OutlineEdgeOptions>(
    k: K,
    v: (i: number) => OutlineEdgeOptions[K] | undefined,
  ) =>
    props.update((x) => {
      if (x.kind !== "area") return x;
      const cur = x.points.map((_, j) => withAttr(x.attrs.edges?.[j] ?? {}, k, v(j)));
      return { ...x, attrs: { ...x.attrs, edges: cur } };
    });
  // Re-apply the Setup tab's edge defaults to every side (tall-wall marks are kept).
  const resetToSetup = () =>
    props.update((x) => {
      if (x.kind !== "area") return x;
      const defaults = defaultEdgeOptions(x.points, props.setup, fpp);
      const cur = defaults.map((d, j) =>
        x.attrs.edges?.[j]?.hasTallWall ? { ...d, hasTallWall: true } : d,
      );
      return { ...x, attrs: { ...x.attrs, edges: cur } };
    });
  const allPerimeter = triState(edges.map((e) => e.isPerimeter ?? false));
  const allBlocking = triState(edges.map((e) => (e.blockingFt ?? 0) > 0));
  const allTermination = common(edges.map((e) => e.termination ?? "No Termination"));
  const allArp = common(edges.map((e) => e.arpSizeIn ?? 0));

  return (
    <div className="space-y-3">
      <p className="text-sm tabular-nums">
        {net === null ? "Area —" : fmtSqFt(net * factor)}
        {net !== null && factor !== 1 && (
          <span className="text-muted-foreground"> ({fmtSqFt(net)} on plan)</span>
        )}
        {fpp !== null && (
          <span className="text-muted-foreground">
            {" "}
            · perimeter {fmtFt(lens.reduce((s, l) => s + l, 0))} · {o.points.length} sides
          </span>
        )}
      </p>
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Pitch (rise per 12)</Label>
          <NumberField
            className="h-8 w-[96px]"
            step="any"
            inputMode="decimal"
            placeholder="flat"
            title="Roof slope as inches of rise per 12 in of run (4 = 4:12). Blank = flat. The area is multiplied by the slope factor; edge lengths stay as drawn."
            value={o.attrs.pitch ?? 0}
            onChange={(v) =>
              props.update((x) =>
                x.kind === "area"
                  ? { ...x, attrs: withAttr(x.attrs, "pitch", v > 0 ? v : undefined) }
                  : x,
              )
            }
          />
        </div>
        <span
          className="pb-2 text-xs tabular-nums text-muted-foreground"
          title="Slope factor: sqrt(1 + (pitch / 12)²) — roof area per plan area"
        >
          {factor === 1 ? "flat (×1)" : slopeFactorLabel(o.attrs.pitch)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-1 font-medium">Side</th>
              <th className="pr-1 font-medium">Length</th>
              <th className="pr-1 font-medium" title="Perimeter edge">
                Perim
              </th>
              <th className="pr-1 font-medium">Termination</th>
              <th className="pr-1 font-medium">Blocking ft</th>
              <th className="pr-1 font-medium">ARP</th>
              <th className="font-medium" title="Tall wall">
                Tall
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t bg-muted/40" title="Change every side at once">
              <td className="py-1 pr-1 font-semibold" colSpan={2}>
                All sides
              </td>
              <td className="pr-1">
                <Checkbox
                  checked={allPerimeter}
                  onCheckedChange={(c) => setAll("isPerimeter", () => c === true)}
                  aria-label="All sides perimeter"
                />
              </td>
              <td className="pr-1">
                <Select
                  value={allTermination ?? ""}
                  onValueChange={(v) => setAll("termination", () => v)}
                >
                  <SelectTrigger
                    className="h-7 w-[118px] px-2 text-xs"
                    aria-label="All sides termination"
                  >
                    <SelectValue placeholder="Mixed" />
                  </SelectTrigger>
                  <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
                    {TERMINATION_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="pr-1">
                <label
                  className="flex items-center gap-1"
                  title={
                    fpp === null
                      ? "Set the page scale first: blocking uses each side's length"
                      : "On: each side's own length in feet; off: none"
                  }
                >
                  <Checkbox
                    checked={allBlocking}
                    disabled={fpp === null}
                    onCheckedChange={(c) =>
                      setAll("blockingFt", (i) =>
                        c === true ? Math.round((lens[i] ?? 0) * 100) / 100 : 0,
                      )
                    }
                    aria-label="All sides blocking"
                  />
                  <span className="text-muted-foreground">full</span>
                </label>
              </td>
              <td className="pr-1">
                <Select
                  value={allArp === undefined ? "" : String(allArp)}
                  onValueChange={(v) => setAll("arpSizeIn", () => Number(v))}
                >
                  <SelectTrigger className="h-7 w-[64px] px-2 text-xs" aria-label="All sides ARP">
                    <SelectValue placeholder="Mixed" />
                  </SelectTrigger>
                  <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
                    {ARP_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 0 ? "None" : `${n} in`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td />
            </tr>
            {edges.map((e, i) => (
              <tr key={i} className="border-t">
                <td className="py-1 pr-1 font-medium">{sideLabels[i]}</td>
                <td className="whitespace-nowrap pr-1 tabular-nums">
                  {fpp === null ? "—" : `${fmtNum(lens[i]!)} ft`}
                </td>
                <td className="pr-1">
                  <Checkbox
                    checked={e.isPerimeter ?? false}
                    onCheckedChange={(c) => setEdge(i, "isPerimeter", c === true)}
                    aria-label={`Side ${sideLabels[i]} perimeter`}
                  />
                </td>
                <td className="pr-1">
                  <Select
                    value={e.termination ?? "No Termination"}
                    onValueChange={(v) => setEdge(i, "termination", v)}
                  >
                    <SelectTrigger className="h-7 w-[118px] px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
                      {TERMINATION_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="pr-1">
                  <Num
                    className="h-7 w-[64px] px-2 text-xs"
                    value={e.blockingFt}
                    onChange={(v) => setEdge(i, "blockingFt", v ?? 0)}
                  />
                </td>
                <td className="pr-1">
                  <Select
                    value={String(e.arpSizeIn ?? 0)}
                    onValueChange={(v) => setEdge(i, "arpSizeIn", Number(v))}
                  >
                    <SelectTrigger className="h-7 w-[64px] px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
                      {ARP_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n === 0 ? "None" : `${n} in`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td>
                  <Checkbox
                    checked={e.hasTallWall ?? false}
                    onCheckedChange={(c) =>
                      setEdge(i, "hasTallWall", c === true ? true : undefined)
                    }
                    aria-label={`Side ${sideLabels[i]} tall wall`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="text-xs text-primary underline-offset-2 hover:underline"
        title="Re-apply the Setup tab's edge defaults (perimeter, termination, blocking, ARP) to every side"
        onClick={(e) => {
          resetToSetup();
          if (e.detail > 0) e.currentTarget.blur();
        }}
      >
        Reset to setup defaults
      </button>
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground">Cut-outs</h4>
        {cutouts.length === 0 && (
          <p className="text-xs text-muted-foreground">
            None. Use the Cut-out tool (X) to subtract a well or penthouse from this area.
          </p>
        )}
        {cutouts.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              Cut-out {i + 1}
              <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                {fpp === null ? "" : fmtSqFt(polygonArea(c) * fpp * fpp)}
              </span>
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive"
              aria-label={`Delete cut-out ${i + 1}`}
              onClick={() =>
                props.update((x) =>
                  x.kind === "area"
                    ? {
                        ...x,
                        attrs: withAttr(
                          x.attrs,
                          "cutouts",
                          (x.attrs.cutouts ?? []).filter((_, j) => j !== i).length
                            ? (x.attrs.cutouts ?? []).filter((_, j) => j !== i)
                            : undefined,
                        ),
                      }
                    : x,
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
