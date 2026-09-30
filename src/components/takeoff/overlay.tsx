/**
 * The SVG drawn over the page: saved objects (areas, linears, counts), the scale line (labelled
 * with the sheet note when the scale was read off the sheet), the shape being drawn, the snap
 * marker (magenta on an object, teal on the plan's own lines), the side picker of "Edge from
 * this area" (each side in its role's colour), and the ghost copy of "Duplicate and stamp".
 * Coordinates are page px at zoom 1 (the SVG's viewBox), so every on-screen size — stroke, font,
 * marker radius — is divided by the zoom to stay constant on screen.
 */
import { memo, type PointerEvent as ReactPointerEvent } from "react";

import { drawnSideLabels, edgeLengths, polygonArea } from "@/lib/takeoff/geometry";
import {
  LINEAR_ROLE_LABELS,
  type LinearRole,
  type PagePoint,
  type PageScale,
  type TakeoffObject,
} from "@/lib/takeoff/model";

import {
  COUNT_LETTERS,
  LEFT_OUT_COLOR,
  LINEAR_ROLE_COLORS,
  centroid,
  feetInches,
  fmtSqFt,
  lengthLabel,
  netAreaSqFt,
  polylineLengthPx,
  polylineMidpoint,
  rectPoints,
  rectSizeLabel,
} from "./shapes";
import type { SnapKind } from "./plan-lines";
import { scaleOrigin } from "./sheet-scale";

const pts = (p: readonly PagePoint[]) => p.map(([x, y]) => `${x},${y}`).join(" ");
const ringPath = (p: readonly PagePoint[]) =>
  p.length ? `M${p.map(([x, y]) => `${x},${y}`).join("L")}Z` : "";

/** A label that stays legible over any drawing: dark text with a white halo. */
export function SvgLabel(props: {
  x: number;
  y: number;
  zoom: number;
  children: string;
  size?: number;
  color?: string;
  anchor?: "start" | "middle" | "end";
  bold?: boolean;
}) {
  const size = (props.size ?? 12) / props.zoom;
  return (
    <text
      x={props.x}
      y={props.y}
      fontSize={size}
      textAnchor={props.anchor ?? "middle"}
      dominantBaseline="middle"
      fill={props.color ?? "#111827"}
      stroke="#ffffff"
      strokeWidth={3 / props.zoom}
      strokeLinejoin="round"
      paintOrder="stroke"
      fontWeight={props.bold ? 600 : 500}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      {props.children}
    </text>
  );
}

export interface ObjectsLayerProps {
  objects: readonly TakeoffObject[];
  fpp: number | null;
  zoom: number;
  selectedId: string | null;
  /** Objects take clicks only in Select mode. */
  interactive: boolean;
  /** Pressing an area's inside or a line: select it (drag moves it once selected). */
  onObjectDown: (id: string, e: ReactPointerEvent<SVGElement>) => void;
  /** Pressing a corner handle or a count pin: drag that one point. */
  onVertexDown: (id: string, index: number, e: ReactPointerEvent<SVGElement>) => void;
}

export const ObjectsLayer = memo(function ObjectsLayer(props: ObjectsLayerProps) {
  const { zoom, fpp } = props;
  const pe = props.interactive ? "auto" : "none";
  return (
    <g>
      {props.objects.map((o) => {
        const color = o.color ?? "#2563eb";
        const sel = o.id === props.selectedId;
        const sw = sel ? 3.5 : 2;
        const down = (e: ReactPointerEvent<SVGElement>) => props.onObjectDown(o.id, e);
        if (o.kind === "area") {
          const cut = o.attrs.cutouts ?? [];
          const [cx, cy] = centroid(o.points);
          const area = netAreaSqFt(o.points, cut, fpp);
          const lens = edgeLengths(o.points);
          const sideLabels = drawnSideLabels(o.points);
          return (
            <g key={o.id}>
              <path
                d={[ringPath(o.points), ...cut.map(ringPath)].join(" ")}
                fill={color}
                fillOpacity={sel ? 0.3 : 0.18}
                fillRule="evenodd"
                stroke={color}
                strokeWidth={sw}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                style={{
                  pointerEvents: pe,
                  cursor: props.interactive ? (sel ? "move" : "pointer") : undefined,
                }}
                onPointerDown={down}
              />
              {cut.map((c, i) => (
                <polygon
                  key={i}
                  points={pts(c)}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: "none" }}
                />
              ))}
              {o.points.map((p, i) => {
                const q = o.points[(i + 1) % o.points.length]!;
                // "A · 100 ft": the side label matches the Objects tab and the bid's Sections
                // screen (A–D from the longest side on a four-sided outline, else 1..N).
                return (
                  <SvgLabel
                    key={i}
                    x={(p[0] + q[0]) / 2}
                    y={(p[1] + q[1]) / 2}
                    zoom={zoom}
                    size={11}
                  >
                    {`${sideLabels[i]} · ${lengthLabel(lens[i]!, fpp)}`}
                  </SvgLabel>
                );
              })}
              <SvgLabel x={cx} y={cy - 8 / zoom} zoom={zoom} bold color={color}>
                {o.attrs.name}
              </SvgLabel>
              <SvgLabel x={cx} y={cy + 8 / zoom} zoom={zoom}>
                {area === null ? "no scale" : fmtSqFt(area)}
              </SvgLabel>
            </g>
          );
        }
        if (o.kind === "linear") {
          const [mx, my] = polylineMidpoint(o.points);
          return (
            <g key={o.id}>
              {/* A wide transparent twin makes a thin line easy to click. */}
              <polyline
                points={pts(o.points)}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
                style={{
                  pointerEvents: pe,
                  cursor: props.interactive ? (sel ? "move" : "pointer") : undefined,
                }}
                onPointerDown={down}
              />
              <polyline
                points={pts(o.points)}
                fill="none"
                stroke={color}
                strokeWidth={sel ? 4.5 : 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
              <SvgLabel x={mx} y={my - 10 / zoom} zoom={zoom} bold color={color}>
                {`${o.attrs.name} · ${lengthLabel(polylineLengthPx(o.points), fpp)}`}
              </SvgLabel>
            </g>
          );
        }
        const r = (sel ? 9 : 8) / zoom;
        return (
          <g key={o.id}>
            {o.points.map(([x, y], i) => (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={color}
                  fillOpacity={0.85}
                  stroke={sel ? "#111827" : "#ffffff"}
                  strokeWidth={sel ? 2 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: pe, cursor: props.interactive ? "move" : undefined }}
                  onPointerDown={(e) => props.onVertexDown(o.id, i, e)}
                />
                <text
                  x={x}
                  y={y}
                  fontSize={10 / zoom}
                  fill="#ffffff"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontWeight={700}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {COUNT_LETTERS[o.attrs.role]}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {props.interactive &&
        props.objects
          .filter((o) => o.id === props.selectedId && o.kind !== "count")
          .map((o) =>
            o.points.map(([x, y], i) => (
              <rect
                key={`${o.id}-${i}`}
                x={x - 5 / zoom}
                y={y - 5 / zoom}
                width={10 / zoom}
                height={10 / zoom}
                fill="#ffffff"
                stroke={o.color ?? "#2563eb"}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "move" }}
                onPointerDown={(e) => props.onVertexDown(o.id, i, e)}
              />
            )),
          )}
    </g>
  );
});

/**
 * The target at the live end of the line being drawn: where the next corner lands (after snap
 * and the square-corner / level / plumb lock), which can sit a little off the mouse itself. A ring with four
 * ticks, sized on screen so it reads the same at any zoom.
 */
export function TargetMarker(props: { at: PagePoint; zoom: number; color: string }) {
  const [x, y] = props.at;
  const z = props.zoom;
  const r = 7 / z;
  const tick = 5 / z;
  const stroke = {
    stroke: props.color,
    strokeWidth: 1.5,
    vectorEffect: "non-scaling-stroke" as const,
  };
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={x} cy={y} r={r} fill="none" {...stroke} />
      <line x1={x - r - tick} y1={y} x2={x - r + tick / 2} y2={y} {...stroke} />
      <line x1={x + r - tick / 2} y1={y} x2={x + r + tick} y2={y} {...stroke} />
      <line x1={x} y1={y - r - tick} x2={x} y2={y - r + tick / 2} {...stroke} />
      <line x1={x} y1={y + r - tick / 2} x2={x} y2={y + r + tick} {...stroke} />
      <circle cx={x} cy={y} r={1.5 / z} fill={props.color} stroke="none" />
    </g>
  );
}

/** Snap marker colours: own objects magenta, the plan's own lines teal. */
const SNAP_COLORS: Record<SnapKind, string> = {
  object: "#d946ef",
  plan: "#0d9488",
  planLine: "#0d9488",
};

/**
 * The small square shown where the cursor has snapped: magenta on another object's corner or
 * the scale line's end, teal on a plan point (a line end or crossing), and a teal diamond on a
 * point along a plan line.
 */
export function SnapMarker(props: { at: PagePoint; zoom: number; kind?: SnapKind }) {
  const kind = props.kind ?? "object";
  const h = 6 / props.zoom;
  const [x, y] = props.at;
  const common = {
    fill: "none",
    stroke: SNAP_COLORS[kind],
    strokeWidth: 2,
    vectorEffect: "non-scaling-stroke" as const,
    style: { pointerEvents: "none" as const },
  };
  if (kind === "planLine")
    return (
      <polygon points={`${x},${y - h} ${x + h},${y} ${x},${y + h} ${x - h},${y}`} {...common} />
    );
  return <rect x={x - h} y={y - h} width={2 * h} height={2 * h} {...common} />;
}

/**
 * "Edge from this area": the area's sides, thick and clickable, each in its own role's colour
 * with "A · 50.3 ft · Parapet wall" beside it (outside the outline, clear of the area's own
 * side labels); left-out sides grey and dashed ("left out"). Clicking a side cycles its role.
 */
export function EdgePicker(props: {
  points: readonly PagePoint[];
  /** Per side: its role, or null when left out. */
  roles: ReadonlyArray<LinearRole | null>;
  fpp: number | null;
  zoom: number;
  onCycle: (side: number) => void;
}) {
  const { points, zoom, fpp } = props;
  const n = points.length;
  const sideLabels = drawnSideLabels(points);
  const lens = edgeLengths(points);
  // The outline's winding (shoelace sign) tells which side of each edge is outside.
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % n]!;
    twice += x1 * y2 - x2 * y1;
  }
  const out = twice > 0 ? -1 : 1;
  return (
    <g>
      {props.roles.map((role, i) => {
        const p = points[i]!;
        const q = points[(i + 1) % n]!;
        const color = role ? LINEAR_ROLE_COLORS[role] : LEFT_OUT_COLOR;
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        // The label sits just outside the side, along its outward normal.
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const nx = (out * -(q[1] - p[1])) / len;
        const ny = (out * (q[0] - p[0])) / len;
        const sideways = Math.abs(nx) > Math.abs(ny);
        const off = (sideways ? 10 : 14) / zoom;
        const text = `${sideLabels[i]} · ${lengthLabel(lens[i]!, fpp)} · ${
          role ? LINEAR_ROLE_LABELS[role] : "left out"
        }`;
        return (
          <g key={i}>
            <line
              x1={p[0]}
              y1={p[1]}
              x2={q[0]}
              y2={q[1]}
              stroke={color}
              strokeWidth={role ? 6 : 3}
              strokeDasharray={role ? undefined : "6 5"}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "none" }}
            />
            {/* A wide transparent twin makes the side easy to click. */}
            <line
              x1={p[0]}
              y1={p[1]}
              x2={q[0]}
              y2={q[1]}
              stroke="transparent"
              strokeWidth={18}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                props.onCycle(i);
              }}
            >
              <title>Click to cycle this side: the current role ↔ left out</title>
            </line>
            <SvgLabel
              x={mx + nx * off}
              y={my + ny * off}
              zoom={zoom}
              size={12}
              anchor={sideways ? (nx > 0 ? "start" : "end") : "middle"}
              color={color}
              bold={!!role}
            >
              {text}
            </SvgLabel>
          </g>
        );
      })}
    </g>
  );
}

/** The page's calibration line with its real length (and the sheet note it was read from). */
export function ScaleLine(props: { scale: PageScale; zoom: number }) {
  const { ax, ay, bx, by, feet } = props.scale;
  const origin = scaleOrigin(props.scale);
  const z = props.zoom;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  // Short end ticks perpendicular to the line.
  const nx = (-(by - ay) / len) * (7 / z);
  const ny = ((bx - ax) / len) * (7 / z);
  return (
    <g style={{ pointerEvents: "none" }}>
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke="#ea580c"
        strokeWidth={2}
        strokeDasharray="8 5"
        vectorEffect="non-scaling-stroke"
      />
      {[
        [ax, ay],
        [bx, by],
      ].map(([x, y], i) => (
        <line
          key={i}
          x1={x! - nx}
          y1={y! - ny}
          x2={x! + nx}
          y2={y! + ny}
          stroke="#ea580c"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <SvgLabel x={(ax + bx) / 2} y={(ay + by) / 2 - 12 / z} zoom={z} color="#c2410c" bold>
        {origin?.source === "sheet"
          ? `Scale read from the sheet: ${origin.note}`
          : `Scale ${feetInches(feet)}`}
      </SvgLabel>
    </g>
  );
}

/** A measuring line (Dimension tool) or the scale line being picked. */
export function MeasureLine(props: {
  a: PagePoint;
  b: PagePoint;
  zoom: number;
  label: string;
  color?: string;
}) {
  const { a, b, zoom } = props;
  const color = props.color ?? "#0f766e";
  return (
    <g style={{ pointerEvents: "none" }}>
      <line
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {[a, b].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3.5 / zoom} fill={color} />
      ))}
      <SvgLabel
        x={(a[0] + b[0]) / 2}
        y={(a[1] + b[1]) / 2 - 12 / zoom}
        zoom={zoom}
        color={color}
        bold
      >
        {props.label}
      </SvgLabel>
    </g>
  );
}

/** The shape being drawn: placed points, the rubber band to the cursor, running numbers. */
export function DraftShape(props: {
  points: readonly PagePoint[];
  cursor: PagePoint | null;
  closed: boolean;
  zoom: number;
  fpp: number | null;
  color: string;
  /** Highlight the first point (hovering it closes the area). */
  nearFirst: boolean;
}) {
  const { points, cursor, zoom, fpp, color } = props;
  const all = cursor ? [...points, cursor] : [...points];
  const last = points[points.length - 1];
  const seg = last && cursor ? Math.hypot(cursor[0] - last[0], cursor[1] - last[1]) : null;
  const areaPx = props.closed && all.length >= 3 ? polygonArea(all) : null;
  const lines: string[] = [];
  if (seg !== null) lines.push(lengthLabel(seg, fpp));
  if (!props.closed && points.length >= 2 && cursor)
    lines.push(`total ${lengthLabel(polylineLengthPx(all), fpp)}`);
  if (areaPx !== null)
    lines.push(fpp === null ? `${Math.round(areaPx)} px²` : fmtSqFt(areaPx * fpp * fpp));
  return (
    <g style={{ pointerEvents: "none" }}>
      {props.closed && all.length >= 3 && (
        <polygon points={pts(all)} fill={color} fillOpacity={0.12} stroke="none" />
      )}
      <polyline
        points={pts(all)}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {points.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={(i === 0 && props.nearFirst ? 7 : 4) / zoom}
          fill={i === 0 && props.nearFirst ? "#facc15" : "#ffffff"}
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {cursor && <TargetMarker at={cursor} zoom={zoom} color={color} />}
      {cursor &&
        lines.map((t, i) => (
          <SvgLabel
            key={i}
            x={cursor[0] + 14 / zoom}
            y={cursor[1] + (18 + i * 15) / zoom}
            zoom={zoom}
            anchor="start"
            bold={i === 0}
          >
            {t}
          </SvgLabel>
        ))}
    </g>
  );
}

/**
 * "Duplicate and stamp": the copy that follows the cursor, drawn like the shape in progress
 * (dashed outline, light fill for an area, its cut-outs dashed too; a count as its pin) at half
 * opacity, with the target on its reference point and "copy" and its size beside it.
 */
export function GhostShape(props: {
  object: TakeoffObject;
  /** The reference point (on the cursor, or where the snap moved it). */
  at: PagePoint;
  zoom: number;
  fpp: number | null;
  color: string;
}) {
  const { object: o, at, zoom, fpp, color } = props;
  const dash = {
    stroke: color,
    strokeWidth: 2,
    strokeDasharray: "6 4",
    vectorEffect: "non-scaling-stroke" as const,
  };
  let size: string | null = null;
  if (o.kind === "area") {
    const area = netAreaSqFt(o.points, o.attrs.cutouts, fpp);
    size = area === null ? null : fmtSqFt(area);
  } else if (o.kind === "linear") size = lengthLabel(polylineLengthPx(o.points), fpp);
  return (
    <g style={{ pointerEvents: "none" }}>
      <g opacity={0.5}>
        {o.kind === "area" && (
          <>
            <path
              d={[ringPath(o.points), ...(o.attrs.cutouts ?? []).map(ringPath)].join(" ")}
              fill={color}
              fillOpacity={0.12}
              fillRule="evenodd"
              {...dash}
            />
            {(o.attrs.cutouts ?? []).map((c, i) => (
              <polygon key={i} points={pts(c)} fill="none" {...dash} strokeWidth={1.5} />
            ))}
          </>
        )}
        {o.kind === "linear" && <polyline points={pts(o.points)} fill="none" {...dash} />}
        {o.kind === "count" &&
          o.points.map(([x, y], i) => (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={8 / zoom}
                fill={color}
                fillOpacity={0.85}
                stroke="#ffffff"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x}
                y={y}
                fontSize={10 / zoom}
                fill="#ffffff"
                textAnchor="middle"
                dominantBaseline="central"
                fontWeight={700}
                style={{ userSelect: "none" }}
              >
                {COUNT_LETTERS[o.attrs.role] ?? COUNT_LETTERS.other}
              </text>
            </g>
          ))}
      </g>
      {o.kind !== "count" && <TargetMarker at={at} zoom={zoom} color={color} />}
      <SvgLabel
        x={at[0] + 14 / zoom}
        y={at[1] + 18 / zoom}
        zoom={zoom}
        anchor="start"
        bold
        color={color}
      >
        {size ? `copy · ${size}` : "copy"}
      </SvgLabel>
    </g>
  );
}

/**
 * The rectangle being dragged out (press one corner, release on the opposite one), drawn like
 * the shape in progress: width × height at the release corner, then the area (area / cut-out)
 * or the perimeter (linear).
 */
export function RectPreview(props: {
  a: PagePoint;
  b: PagePoint;
  /** Fill it (area / cut-out) or draw only the outline (linear). */
  filled: boolean;
  zoom: number;
  fpp: number | null;
  color: string;
}) {
  const { a, b, zoom, fpp, color } = props;
  const rect = rectPoints(a, b);
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  const lines = [rectSizeLabel(a, b, fpp)];
  if (props.filled)
    lines.push(fpp === null ? `${Math.round(w * h)} px²` : fmtSqFt(w * h * fpp * fpp));
  else lines.push(`total ${lengthLabel(2 * (w + h), fpp)}`);
  return (
    <g style={{ pointerEvents: "none" }}>
      <polygon
        points={pts(rect)}
        fill={props.filled ? color : "none"}
        fillOpacity={0.12}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {rect.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={4 / zoom}
          fill="#ffffff"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lines.map((t, i) => (
        <SvgLabel
          key={i}
          x={b[0] + 14 / zoom}
          y={b[1] + (18 + i * 15) / zoom}
          zoom={zoom}
          anchor="start"
          bold={i === 0}
        >
          {t}
        </SvgLabel>
      ))}
    </g>
  );
}
