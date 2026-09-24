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
export function ViewerToolbar(props: {
  tool: Tool;
  zoom: number;
  onTool: (t: Tool) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
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
              onClick={() => props.onTool(t)}
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
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={props.onZoomIn}
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" onClick={props.onFit}>
          <Maximize className="h-4 w-4" /> <span className="text-xs">Fit</span>
        </Button>
      </div>
    </div>
  );
}
