/**
 * The viewer's tool bar: the tools with their keys, "Edge from this area" while an area is
 * selected, "Duplicate" (Ctrl+D; stamps copies of the selected object, enabled only with one
 * selected), "Snap to plan" (PDF plans only, with its line count or "reading plan lines…"), and
 * the zoom buttons. With Linear or Count (or "Edge from this area") a second line under the
 * tools holds the role chips (owner, Sep 30): plain names, no number prefix (it read like a
 * quantity); keys 1–6 still pick them, named only in each chip's tooltip.
 *
 * Owner, Sep 30: every tool button and role chip has a hover tooltip (`Tip`, the app's Tooltip
 * with a 300 ms delay): its name, one short sentence on what it is for, and its key if it has
 * one ("Area — draw a roof area: click corners, or drag a box (A)").
 */
import type { ReactElement, ReactNode } from "react";
import {
  Copy,
  Magnet,
  MapPin,
  Maximize,
  MousePointer2,
  MoveHorizontal,
  Pentagon,
  Ruler,
  Scissors,
  Spline,
  SquareDashed,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { toolAllowed } from "@/lib/takeoff/lock";

import { TOOL_KEYS, type Tool } from "./shapes";

/** How long the pointer rests on a control before its tooltip opens. */
export const TIP_DELAY_MS = 300;

/**
 * A hover tooltip: `name` in bold, then " — " and `text` (one short sentence with the key, if
 * any). `wrap` puts the control in a span first — a disabled button takes no hover itself.
 */
export function Tip(props: {
  name: string;
  text?: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  wrap?: boolean;
  /** The wrapping span's classes (default inline-flex). */
  wrapClassName?: string;
}) {
  return (
    <Tooltip delayDuration={TIP_DELAY_MS}>
      <TooltipTrigger asChild>
        {props.wrap ? (
          <span className={props.wrapClassName ?? "inline-flex"}>{props.children}</span>
        ) : (
          props.children
        )}
      </TooltipTrigger>
      <TooltipContent side={props.side ?? "top"} className="max-w-xs">
        <span className="font-semibold">{props.name}</span>
        {props.text ? <> — {props.text}</> : null}
      </TooltipContent>
    </Tooltip>
  );
}

const TOOLS: Array<{ tool: Tool; label: string; purpose: string; icon: LucideIcon }> = [
  { tool: "select", label: "Select", purpose: "pick, move or edit a shape", icon: MousePointer2 },
  {
    tool: "scale",
    label: "Scale",
    purpose: "set the sheet's scale from a known length",
    icon: Ruler,
  },
  {
    tool: "area",
    label: "Area",
    purpose: "draw a roof area: click corners, or drag a box",
    icon: Pentagon,
  },
  {
    tool: "linear",
    label: "Linear",
    purpose: "measure a length: parapet, gutter, edge",
    icon: Spline,
  },
  {
    tool: "count",
    label: "Count",
    purpose: "drop a pin per item: drains, curbs, stacks",
    icon: MapPin,
  },
  {
    tool: "dimension",
    label: "Dimension",
    purpose: "check a distance without saving it",
    icon: MoveHorizontal,
  },
  {
    tool: "cutout",
    label: "Cut-out",
    purpose: "subtract a well or penthouse from the selected area",
    icon: Scissors,
  },
];
/** The "Snap to plan" toggle and what it knows of the page's plan lines. */
export interface PlanSnapToggle {
  /** False for an image underlay (it has no lines to read). */
  available: boolean;
  on: boolean;
  /** "reading plan lines…", "1,234 plan lines", or null. */
  status: string | null;
  onToggle: () => void;
}

/** Role chips for the next count / linear (keys 1–6 pick them, in this order). */
export interface RoleChips {
  /** What the chips pick, shown at the start of their line ("Line role"). */
  title: string;
  /** Each role with its purpose for the tooltip ("the roof edge that meets a wall"). */
  options: Array<{ value: string; label: string; hint: string }>;
  value: string;
  onChange: (value: string) => void;
}

export function ViewerToolbar(props: {
  tool: Tool;
  zoom: number;
  onTool: (t: Tool) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** A locked takeoff: only Select and Dimension are enabled. */
  readOnly?: boolean;
  roles: RoleChips | null;
  /** Snap to the plan's own lines; null hides the toggle. */
  planSnap?: PlanSnapToggle | null;
  /** "Edge from this area" for the selected area; null when no area is selected. */
  edgeFromArea?: { active: boolean; onClick: () => void } | null;
  /** "Duplicate and stamp": active while stamping; disabled with nothing selected. */
  duplicate?: { active: boolean; enabled: boolean; onClick: () => void } | null;
}) {
  const ps = props.planSnap;
  const dup = props.duplicate;
  return (
    <div className="border-b bg-background">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {TOOLS.map(({ tool: t, label, purpose, icon: Icon }) => {
          const off = !toolAllowed(t, !!props.readOnly);
          return (
            <Tip
              key={t}
              name={label}
              wrap={off}
              text={
                off
                  ? "locked: this takeoff built a bid (Edit a copy to draw)"
                  : `${purpose} (${TOOL_KEYS[t]})`
              }
            >
              <Button
                size="sm"
                variant={props.tool === t ? "default" : "ghost"}
                disabled={off}
                className="h-8 gap-1 px-2"
                onClick={(e) => {
                  props.onTool(t);
                  if (e.detail > 0) e.currentTarget.blur();
                }}
                aria-pressed={props.tool === t}
                aria-label={label}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden text-xs lg:inline">{label}</span>
              </Button>
            </Tip>
          );
        })}
        {props.edgeFromArea && (
          <Tip
            name="Edge from this area"
            text={
              props.edgeFromArea.active
                ? "on: click again to cancel (Esc)"
                : "turn the area's sides into parapet, gutter or other lines"
            }
          >
            <Button
              size="sm"
              variant={props.edgeFromArea.active ? "default" : "ghost"}
              className="ml-1 h-8 gap-1 px-2"
              aria-pressed={props.edgeFromArea.active}
              aria-label="Edge from this area"
              onClick={(e) => {
                props.edgeFromArea?.onClick();
                if (e.detail > 0) e.currentTarget.blur();
              }}
            >
              <SquareDashed className="h-4 w-4" />
              <span className="hidden text-xs lg:inline">Edge from this area</span>
            </Button>
          </Tip>
        )}
        {dup && (
          <Tip
            name="Duplicate"
            wrap={!dup.enabled && !dup.active}
            text={
              dup.active
                ? "stop stamping copies (right-click or Esc)"
                : dup.enabled
                  ? "stamp copies of the selected shape (Ctrl+D)"
                  : "select a shape first, then stamp copies of it (Ctrl+D)"
            }
          >
            <Button
              size="sm"
              variant={dup.active ? "default" : "ghost"}
              className="ml-1 h-8 gap-1 px-2"
              disabled={!dup.enabled && !dup.active}
              aria-pressed={dup.active}
              aria-label="Duplicate"
              onClick={(e) => {
                dup.onClick();
                if (e.detail > 0) e.currentTarget.blur();
              }}
            >
              <Copy className="h-4 w-4" />
              <span className="hidden text-xs lg:inline">Duplicate</span>
            </Button>
          </Tip>
        )}
        <div className="ml-auto flex items-center gap-1">
          {ps && (
            <>
              {ps.available && ps.on && ps.status && (
                <span className="mr-1 hidden text-[11px] text-muted-foreground md:inline">
                  {ps.status}
                </span>
              )}
              {!ps.available && (
                <span className="mr-1 hidden text-[11px] text-muted-foreground md:inline">
                  only for PDF plans
                </span>
              )}
              <Tip
                name="Snap to plan"
                wrap={!ps.available}
                text={
                  ps.available
                    ? "corners snap to the plan's own lines (PDF only); hold Shift for no snap"
                    : "only for PDF plans (an image has no lines to read)"
                }
              >
                <Button
                  size="sm"
                  variant={ps.available && ps.on ? "secondary" : "ghost"}
                  className="h-8 gap-1 px-2"
                  disabled={!ps.available}
                  aria-pressed={ps.available && ps.on}
                  aria-label="Snap to plan"
                  onClick={(e) => {
                    ps.onToggle();
                    if (e.detail > 0) e.currentTarget.blur();
                  }}
                >
                  <Magnet className="h-4 w-4" />
                  <span className="hidden text-xs lg:inline">Snap to plan</span>
                </Button>
              </Tip>
            </>
          )}
          <span className="mr-1 text-xs tabular-nums text-muted-foreground">
            {Math.round(props.zoom * 100)}%
          </span>
          <Tip name="Zoom out" text="see more of the page (− or the mouse wheel)">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={props.onZoomOut}
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </Tip>
          <Tip name="Zoom in" text="look closer (+ or the mouse wheel)">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={props.onZoomIn}
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </Tip>
          <Tip name="Fit" text="show the whole page (0 or Home)">
            <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" onClick={props.onFit}>
              <Maximize className="h-4 w-4" /> <span className="text-xs">Fit</span>
            </Button>
          </Tip>
        </div>
      </div>
      {props.roles && (
        <div
          className="flex flex-wrap items-center gap-1 border-t bg-muted/30 px-2 py-1.5"
          role="radiogroup"
          aria-label={props.roles.title}
        >
          <span className="mr-1 text-xs font-medium text-muted-foreground">
            {props.roles.title}
          </span>
          {props.roles.options.map((o, i) => {
            const on = o.value === props.roles?.value;
            return (
              <Tip key={o.value} name={o.label} text={`${o.hint} (key ${i + 1})`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={(e) => {
                    props.roles?.onChange(o.value);
                    // Mouse click: give the keys back to the drawing.
                    if (e.detail > 0) e.currentTarget.blur();
                  }}
                  className={`flex h-7 items-center rounded-full border px-3 text-xs transition-colors ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  {o.label}
                </button>
              </Tip>
            );
          })}
        </div>
      )}
    </div>
  );
}
