/**
 * The viewer's tool bar: the tools with their keys, "Edge from this area" while an area is
 * selected, "Duplicate" (Ctrl+D; stamps copies of the selected object, enabled only with one
 * selected), the snap toggles, "Snap to plan" (PDF plans only, with its line count or "reading
 * plan lines…"), the View menu, the zoom buttons and a "?" that lists every tool's tip. With
 * Linear or Penetrations (or "Edge from this area") a second line under the tools holds the role
 * chips (owner, Sep 30): plain names, no number prefix (it read like a quantity); keys 1–7 still
 * pick them, named only in each chip's tooltip.
 *
 * Owner, Sep 30: every tool button and role chip has a hover tooltip (`Tip`, the app's Tooltip
 * with a 300 ms delay): its name, one short sentence on what it is for, and its key if it has
 * one ("Area — draw a roof area: click corners, or drag a box (A)").
 *
 * Owner, Oct 27: (1) "Square corners" and "Snap to corners" are toggles here, on every underlay
 * kind, default off (./snap-prefs.ts; Shift inverts them for a moment). (2) The bottom hint
 * paragraph is gone: a tool button's tooltip carries its full tip (./hints.ts `toolTip`), the
 * zoom buttons' the zoom / pan line, and the Scale button's the "scale set from the aerial /
 * sheet" note when there is one; the "?" button (touch devices have no hover) opens a Popover
 * with every tool and its tip. (3) The eye "View" menu shows or hides fills, labels and lines
 * or shows only the selected object (./view-prefs.ts; keys F and Shift+L).
 */
import type { ReactElement, ReactNode } from "react";
import {
  CircleHelp,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Magnet,
  MapPin,
  Maximize,
  MousePointer2,
  MoveHorizontal,
  Pentagon,
  Ruler,
  Scissors,
  Spline,
  Square,
  SquareDashed,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { toolAllowed } from "@/lib/takeoff/lock";

import {
  EDGE_HINT,
  STAMP_HINT,
  VIEW_HINT,
  ZOOM_HINT,
  toolTip,
  toolTips,
  type DrawNoteContext,
} from "./hints";
import { TOOL_KEYS, type Tool } from "./shapes";
import type { SnapPrefKey } from "./snap-prefs";
import { VIEW_FLAG_KEYS, VIEW_FLAG_LABELS, type ViewFlagKey, type ViewFlags } from "./view-prefs";

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
      <TooltipContent side={props.side ?? "top"} className="max-w-sm">
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
    label: "Penetrations",
    purpose: "drop a pin per item: drains, stacks, curbs, deficiencies",
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

/** The "Square corners" / "Snap to corners" toggles (default off; Shift inverts both). */
export interface SnapToggles {
  square: boolean;
  corners: boolean;
  /** Shift is held: the buttons show the inverted state they apply right now. */
  shift: boolean;
  onToggle: (key: SnapPrefKey) => void;
}

/** The View menu: fills / labels / lines / only selected. */
export interface ViewMenu {
  flags: ViewFlags;
  onToggle: (key: ViewFlagKey) => void;
}

/** Role chips for the next penetration / linear (keys 1–7 pick them, in this order). */
export interface RoleChips {
  /** What the chips pick, shown at the start of their line ("Line role"). */
  title: string;
  /** Each role with its purpose for the tooltip ("the roof edge that meets a wall"). */
  options: Array<{ value: string; label: string; hint: string }>;
  value: string;
  onChange: (value: string) => void;
}

const VIEW_ORDER: ViewFlagKey[] = ["fills", "labels", "lines", "onlySelected"];

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
  /** What the drawing notes in the tool tips say (the toggles' state, the plan, the scale). */
  tips: DrawNoteContext;
  /** The snap toggles; null hides them (a locked takeoff). */
  snap?: SnapToggles | null;
  /** Snap to the plan's own lines; null hides the toggle. */
  planSnap?: PlanSnapToggle | null;
  view: ViewMenu;
  /** "Scale set from the aerial imagery…" — folded into the Scale button's tooltip. */
  scaleNote?: string | null;
  /** "Edge from this area" for the selected area; null when no area is selected. */
  edgeFromArea?: { active: boolean; onClick: () => void } | null;
  /** "Duplicate and stamp": active while stamping; disabled with nothing selected. */
  duplicate?: { active: boolean; enabled: boolean; onClick: () => void } | null;
}) {
  const ps = props.planSnap;
  const dup = props.duplicate;
  const snap = props.snap;
  const anyHidden = VIEW_ORDER.some((k) =>
    k === "onlySelected" ? props.view.flags[k] : !props.view.flags[k],
  );
  const blur = (e: { detail: number; currentTarget: HTMLElement }) => {
    // Mouse click: hand the keys back to the drawing.
    if (e.detail > 0) e.currentTarget.blur();
  };
  return (
    <div className="border-b bg-background">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {TOOLS.map(({ tool: t, label, purpose, icon: Icon }) => {
          const off = !toolAllowed(t, !!props.readOnly);
          const full = toolTip(t, props.tips);
          const note = t === "scale" && props.scaleNote ? ` ${props.scaleNote}` : "";
          return (
            <Tip
              key={t}
              name={`${label} (${TOOL_KEYS[t]})`}
              wrap={off}
              text={
                off
                  ? "locked: this takeoff built a bid (Edit a copy to draw)"
                  : `${purpose}. ${full}${note}`
              }
            >
              <Button
                size="sm"
                variant={props.tool === t ? "default" : "ghost"}
                disabled={off}
                className="h-8 gap-1 px-2"
                onClick={(e) => {
                  props.onTool(t);
                  blur(e);
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
                ? `on: click again to cancel (Esc). ${EDGE_HINT}`
                : `turn the area's sides into parapet, gutter or other lines, one line per side. ${EDGE_HINT}`
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
                blur(e);
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
                ? `stop stamping copies (right-click or Esc). ${STAMP_HINT}`
                : dup.enabled
                  ? `stamp copies of the selected shape (Ctrl+D). ${STAMP_HINT}`
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
                blur(e);
              }}
            >
              <Copy className="h-4 w-4" />
              <span className="hidden text-xs lg:inline">Duplicate</span>
            </Button>
          </Tip>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {snap && (
            <>
              <Tip
                name="Square corners"
                text={`${
                  snap.square
                    ? "on: a side nearly square to the previous one, or nearly level / plumb, locks to it"
                    : "off: sides keep the angle drawn (the angle shows by the cursor)"
                }${snap.shift ? " — Shift is held, so the opposite applies right now" : ""}. Hold Shift to invert it for a moment. Remembered in this browser.`}
              >
                <Button
                  size="sm"
                  variant={snap.square !== snap.shift ? "secondary" : "ghost"}
                  className="h-8 gap-1 px-2"
                  aria-pressed={snap.square}
                  aria-label="Square corners"
                  onClick={(e) => {
                    snap.onToggle("square");
                    blur(e);
                  }}
                >
                  <Square className="h-4 w-4" />
                  <span className="hidden text-xs lg:inline">Square corners</span>
                </Button>
              </Tip>
              <Tip
                name="Snap to corners"
                text={`${
                  snap.corners
                    ? "on: the cursor snaps to other objects' corners and the scale line's ends"
                    : "off: the cursor goes exactly where you click"
                }${snap.shift ? " — Shift is held, so the opposite applies right now" : ""}. Hold Shift to invert it for a moment. Remembered in this browser.`}
              >
                <Button
                  size="sm"
                  variant={snap.corners !== snap.shift ? "secondary" : "ghost"}
                  className="h-8 gap-1 px-2"
                  aria-pressed={snap.corners}
                  aria-label="Snap to corners"
                  onClick={(e) => {
                    snap.onToggle("corners");
                    blur(e);
                  }}
                >
                  <Crosshair className="h-4 w-4" />
                  <span className="hidden text-xs lg:inline">Snap to corners</span>
                </Button>
              </Tip>
            </>
          )}
          {ps && (
            <>
              {ps.available && ps.on && ps.status && (
                <span className="mr-1 hidden text-[11px] text-muted-foreground xl:inline">
                  {ps.status}
                </span>
              )}
              <Tip
                name="Snap to plan"
                wrap={!ps.available}
                text={
                  ps.available
                    ? `corners snap to the plan's own lines (PDF only); hold Shift for no plan snap. ${ps.status ?? ""}`
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
                    blur(e);
                  }}
                >
                  <Magnet className="h-4 w-4" />
                  <span className="hidden text-xs lg:inline">Snap to plan</span>
                </Button>
              </Tip>
            </>
          )}
          <DropdownMenu>
            <Tip name="View" text={VIEW_HINT}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant={anyHidden ? "secondary" : "ghost"}
                  className="h-8 gap-1 px-2"
                  aria-label="View"
                >
                  {anyHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  <span className="hidden text-xs lg:inline">View</span>
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs">Show on the drawing</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {VIEW_ORDER.map((k) => (
                <DropdownMenuCheckboxItem
                  key={k}
                  checked={props.view.flags[k]}
                  onCheckedChange={() => props.view.onToggle(k)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {VIEW_FLAG_LABELS[k]}
                  {VIEW_FLAG_KEYS[k] && (
                    <DropdownMenuShortcut>{VIEW_FLAG_KEYS[k]}</DropdownMenuShortcut>
                  )}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                The selected object always keeps its outline.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mr-1 text-xs tabular-nums text-muted-foreground">
            {Math.round(props.zoom * 100)}%
          </span>
          <Tip name="Zoom out" text={`see more of the page (−). ${ZOOM_HINT}`}>
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
          <Tip name="Zoom in" text={`look closer (+). ${ZOOM_HINT}`}>
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
          <Tip name="Fit" text={`show the whole page (0 or Home). ${ZOOM_HINT}`}>
            <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" onClick={props.onFit}>
              <Maximize className="h-4 w-4" /> <span className="text-xs">Fit</span>
            </Button>
          </Tip>
          <Popover>
            <Tip name="Tips" text="every tool and what it does (for a touch screen, with no hover)">
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Tips">
                  <CircleHelp className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </Tip>
            <PopoverContent
              align="end"
              className="max-h-[70vh] w-[min(420px,calc(100vw-1rem))] overflow-y-auto p-3 text-xs"
            >
              <p className="mb-2 text-sm font-semibold">Tools</p>
              <ul className="space-y-2">
                {toolTips(TOOLS, TOOL_KEYS, props.tips).map((t) => (
                  <li key={t.tool}>
                    <span className="font-semibold">{t.label}</span>{" "}
                    <span className="text-muted-foreground">({t.key})</span> — {t.tip}
                  </li>
                ))}
                <li>
                  <span className="font-semibold">Edge from this area</span> — {EDGE_HINT}
                </li>
                <li>
                  <span className="font-semibold">Duplicate</span>{" "}
                  <span className="text-muted-foreground">(Ctrl+D)</span> — {STAMP_HINT}
                </li>
                <li>
                  <span className="font-semibold">View</span> — {VIEW_HINT}
                </li>
                <li>
                  <span className="font-semibold">Zoom</span> — {ZOOM_HINT}
                </li>
              </ul>
            </PopoverContent>
          </Popover>
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
                    blur(e);
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
