/**
 * The viewer's tool bar: the tools with their keys, the role chips for the next count / linear,
 * "Edge from this area" while an area is selected, "Duplicate" (Ctrl+D; stamps copies of the
 * selected object, enabled only with one selected), "Snap to plan" (PDF plans only, with its line
 * count or "reading plan lines…"), and the zoom buttons.
 */
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

import { TOOL_KEYS, type Tool } from "./shapes";

const TOOLS: Array<{ tool: Tool; label: string; icon: LucideIcon }> = [
  { tool: "select", label: "Select", icon: MousePointer2 },
  { tool: "scale", label: "Scale", icon: Ruler },
  { tool: "area", label: "Area", icon: Pentagon },
  { tool: "linear", label: "Linear", icon: Spline },
  { tool: "count", label: "Count", icon: MapPin },
  { tool: "dimension", label: "Dimension", icon: MoveHorizontal },
  { tool: "cutout", label: "Cut-out", icon: Scissors },
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

/** Role chips for the next count / linear (keys 1–6 pick them). */
export interface RoleChips {
  options: Array<{ value: string; label: string }>;
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
  roles: RoleChips | null;
  /** Snap to the plan's own lines; null hides the toggle. */
  planSnap?: PlanSnapToggle | null;
  /** "Edge from this area" for the selected area; null when no area is selected. */
  edgeFromArea?: { active: boolean; onClick: () => void } | null;
  /** "Duplicate and stamp": active while stamping; disabled with nothing selected. */
  duplicate?: { active: boolean; enabled: boolean; onClick: () => void } | null;
}) {
  const ps = props.planSnap;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5">
      {TOOLS.map(({ tool: t, label, icon: Icon }) => (
        <Tooltip key={t}>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={props.tool === t ? "default" : "ghost"}
              className="h-8 gap-1 px-2"
              onClick={(e) => {
                props.onTool(t);
                if (e.detail > 0) e.currentTarget.blur();
              }}
              aria-pressed={props.tool === t}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden text-xs lg:inline">{label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {label} ({TOOL_KEYS[t]})
          </TooltipContent>
        </Tooltip>
      ))}
      {props.roles && (
        <div
          className="ml-1 flex flex-wrap items-center gap-1 border-l pl-2"
          role="radiogroup"
          aria-label="Role of the next object"
        >
          {props.roles.options.map((o, i) => {
            const on = o.value === props.roles?.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                title={`${o.label} (${i + 1})`}
                onClick={(e) => {
                  props.roles?.onChange(o.value);
                  // Mouse click: give the keys back to the drawing.
                  if (e.detail > 0) e.currentTarget.blur();
                }}
                className={`flex h-7 items-center gap-1 rounded-full border px-2 text-xs transition-colors ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                <span
                  className={`text-[10px] tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}
                >
                  {i + 1}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
      {props.edgeFromArea && (
        <Button
          size="sm"
          variant={props.edgeFromArea.active ? "default" : "ghost"}
          className="ml-1 h-8 gap-1 px-2"
          aria-pressed={props.edgeFromArea.active}
          title="Make linears along the selected area's sides (leave out walls or shared edges)"
          onClick={(e) => {
            props.edgeFromArea?.onClick();
            if (e.detail > 0) e.currentTarget.blur();
          }}
        >
          <SquareDashed className="h-4 w-4" />
          <span className="hidden text-xs lg:inline">Edge from this area</span>
        </Button>
      )}
      {props.duplicate && (
        <Button
          size="sm"
          variant={props.duplicate.active ? "default" : "ghost"}
          className="ml-1 h-8 gap-1 px-2"
          disabled={!props.duplicate.enabled && !props.duplicate.active}
          aria-pressed={props.duplicate.active}
          title={
            props.duplicate.active
              ? "Stop stamping copies (right-click or Esc)"
              : props.duplicate.enabled
                ? "Duplicate the selected object: a copy follows the cursor and each click stamps one (Ctrl+D)"
                : "Duplicate: select an area, line or count first (Ctrl+D)"
          }
          onClick={(e) => {
            props.duplicate?.onClick();
            if (e.detail > 0) e.currentTarget.blur();
          }}
        >
          <Copy className="h-4 w-4" />
          <span className="hidden text-xs lg:inline">Duplicate</span>
        </Button>
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
            <Button
              size="sm"
              variant={ps.available && ps.on ? "secondary" : "ghost"}
              className="h-8 gap-1 px-2"
              disabled={!ps.available}
              aria-pressed={ps.available && ps.on}
              title={
                ps.available
                  ? "Snap to the plan's own lines: their ends, crossings and anywhere along them (teal marker). Hold Shift to draw without any snap."
                  : "Snap to plan: only for PDF plans (an image has no lines to read)"
              }
              onClick={(e) => {
                ps.onToggle();
                if (e.detail > 0) e.currentTarget.blur();
              }}
            >
              <Magnet className="h-4 w-4" />
              <span className="hidden text-xs lg:inline">Snap to plan</span>
            </Button>
          </>
        )}
        <span className="mr-1 text-xs tabular-nums text-muted-foreground">
          {Math.round(props.zoom * 100)}%
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={props.onZoomOut}
          aria-label="Zoom out"
          title="Zoom out (−)"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={props.onZoomIn}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 px-2"
          onClick={props.onFit}
          title="Fit the page (0 or Home)"
        >
          <Maximize className="h-4 w-4" /> <span className="text-xs">Fit</span>
        </Button>
      </div>
    </div>
  );
}
