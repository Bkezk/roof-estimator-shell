/**
 * The SVG drawn over the page: saved objects (areas, linears, counts), the scale line, and the
 * shape being drawn. Coordinates are page px at zoom 1 (the SVG's viewBox), so every on-screen
 * size — stroke, font, marker radius — is divided by the zoom to stay constant on screen.
 */
import { memo, type PointerEvent as ReactPointerEvent } from "react";

import { drawnSideLabels, edgeLengths, polygonArea } from "@/lib/takeoff/geometry";
import type { PagePoint, PageScale, TakeoffObject } from "@/lib/takeoff/model";

import {
  COUNT_LETTERS,
  centroid,
  feetInches,
  fmtSqFt,
  lengthLabel,
  netAreaSqFt,
  polylineLengthPx,
  polylineMidpoint,
} from "./shapes";

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
  onObjectDown: (id: string, e: ReactPointerEvent<SVGElement>) => void;
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
                style={{ pointerEvents: pe, cursor: props.interactive ? "pointer" : undefined }}
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
                style={{ pointerEvents: pe, cursor: props.interactive ? "pointer" : undefined }}
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
                  style={{ pointerEvents: pe, cursor: props.interactive ? "pointer" : undefined }}
                  onPointerDown={down}
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

/** The page's calibration line with its real length. */
export function ScaleLine(props: { scale: PageScale; zoom: number }) {
  const { ax, ay, bx, by, feet } = props.scale;
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
        {`Scale ${feetInches(feet)}`}
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
