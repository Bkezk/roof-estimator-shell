/**
 * Objects tab — every drawn object grouped by kind, and the editor for the selected one: an
 * area's per-side edge table and cut-outs, a linear's role (and parapet height), a count's role
 * and sizes. Number boxes stay blank when 0 (placeholder 0); nothing is prefilled.
 */
import { AlertTriangle, Trash2 } from "lucide-react";

import { ARP_SIZE_OPTIONS, TERMINATION_OPTIONS } from "@/lib/engine/edges";
import { drawnSideLabels, polygonArea, type OutlineEdgeOptions } from "@/lib/takeoff/geometry";
import {
  COUNT_ROLES,
  COUNT_ROLE_LABELS,
  LINEAR_ROLES,
  LINEAR_ROLE_LABELS,
  feetPerPx,
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

import { DrainFields } from "./drain-fields";
import {
  COUNT_BASE_NAMES,
  LINEAR_BASE_NAMES,
  drainDefaults,
  edgeLengthsFt,
  fmtFt,
  fmtNum,
  fmtSqFt,
  isDefaultName,
  netAreaSqFt,
  polylineLengthPx,
  uniqueName,
  withDrainPick,
  withoutDrainPicks,
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
}

const KIND_TITLES = { area: "Areas", linear: "Linears", count: "Counts" } as const;

export function ObjectsTab(props: ObjectsTabProps) {
  const { objects, pages, quantities } = props;
  const unscaled = new Set(quantities.unscaled.map((u) => u.objectId));
  const pageOf = (i: number) => pages.find((p) => p.index === i);
  const selected = objects.find((o) => o.id === props.selectedId) ?? null;

  const summary = (o: TakeoffObject): string => {
    const fpp = feetPerPx(pageOf(o.page)?.scale);
    if (o.kind === "count") return `qty ${Math.max(1, o.points.length)}`;
    if (fpp === null) return "";
    if (o.kind === "area") return fmtSqFt(netAreaSqFt(o.points, o.attrs.cutouts, fpp) ?? 0);
    return fmtFt(polylineLengthPx(o.points) * fpp);
  };

  return (
    <div className="space-y-4">
      {selected ? (
        <SelectedEditor
          key={selected.id}
          object={selected}
          page={pageOf(selected.page)}
          objects={objects}
          setup={props.setup}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Draw with Area, Linear or Count, or click an object (Select tool) to edit it here.
        </p>
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
                onClick={() => props.onSelect(o.id)}
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
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          onClick={() => props.onDelete(o.id)}
          aria-label="Delete object"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {fpp === null && o.kind !== "count" && (
        <p className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
          No scale on this page — set one with the Scale tool to get real sizes.
        </p>
      )}
      {o.kind === "area" && <AreaEditor object={o} fpp={fpp} update={update} />}
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
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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

function AreaEditor(props: {
  object: Extract<TakeoffObject, { kind: "area" }>;
  fpp: number | null;
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

  return (
    <div className="space-y-3">
      <p className="text-sm tabular-nums">
        {net === null ? "Area —" : fmtSqFt(net)}
        {fpp !== null && (
          <span className="text-muted-foreground">
            {" "}
            · perimeter {fmtFt(lens.reduce((s, l) => s + l, 0))} · {o.points.length} sides
          </span>
        )}
      </p>
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
                    <SelectContent>
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
                    <SelectContent>
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
