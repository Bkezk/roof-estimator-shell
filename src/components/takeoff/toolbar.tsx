/** The viewer's tool bar, the tool list with its keys and hints, and the key-target check. */
import {
  MapPin,
  Maximize,
  MousePointer2,
  MoveHorizontal,
  Pentagon,
  Ruler,
  Scissors,
  Spline,
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
}) {
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
      <div className="ml-auto flex items-center gap-1">
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
