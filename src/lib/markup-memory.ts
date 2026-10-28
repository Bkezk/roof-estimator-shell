/**
 * The photo markup editor's last tool and colour, remembered per device (owner, Oct 28: mark up
 * as you shoot — the next shot opens with the same pen). localStorage behind try/catch: a phone
 * in private mode, or blocked site data, simply starts from the defaults. Pure over a Storage-like
 * object so it is unit-tested; the editor passes window.localStorage.
 */
import { DEFAULT_PHOTO_COLOR, PHOTO_COLORS, type PhotoColor } from "@/lib/photo-annotations";

export const MARKUP_TOOLS = ["move", "ellipse", "arrow", "rect", "text", "tag"] as const;
export type MarkupTool = (typeof MARKUP_TOOLS)[number];
export const DEFAULT_MARKUP_TOOL: MarkupTool = "ellipse";

export const MARKUP_MEMORY_KEY = "jbk:photo-markup";

export interface MarkupMemory {
  tool: MarkupTool;
  color: PhotoColor;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const isTool = (v: unknown): v is MarkupTool => MARKUP_TOOLS.includes(v as MarkupTool);
const isColor = (v: unknown): v is PhotoColor => PHOTO_COLORS.some((c) => c.id === v);

/** The remembered tool and colour; the defaults for anything missing, unknown or unreadable. */
export function readMarkupMemory(storage: StorageLike | null | undefined): MarkupMemory {
  const fallback: MarkupMemory = { tool: DEFAULT_MARKUP_TOOL, color: DEFAULT_PHOTO_COLOR };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(MARKUP_MEMORY_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const p = parsed as Record<string, unknown>;
    return {
      tool: isTool(p["tool"]) ? p["tool"] : fallback.tool,
      color: isColor(p["color"]) ? p["color"] : fallback.color,
    };
  } catch {
    return fallback;
  }
}

/** Remember the tool and colour; a storage that refuses is ignored. */
export function writeMarkupMemory(storage: StorageLike | null | undefined, memory: MarkupMemory) {
  if (!storage) return;
  try {
    storage.setItem(MARKUP_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Private mode / blocked site data: the next editor starts from the defaults.
  }
}

/** window.localStorage when there is one that can be touched, else null (SSR, blocked). */
export function deviceStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
