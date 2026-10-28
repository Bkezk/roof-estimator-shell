/**
 * The photo markup editor's last tool and colour, remembered per device (owner, Oct 28: mark up
 * as you shoot — the next shot opens with the same pen), and the last five labels written as a
 * text or a tag (the phone's bottom sheet offers them as chips, so "Open seam" is one tap the
 * second time). localStorage behind try/catch: a phone in private mode, or blocked site data,
 * simply starts from the defaults. Pure over a Storage-like object so it is unit-tested; the
 * editor passes window.localStorage.
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

// ── The last labels ──────────────────────────────────────────────────────────────────────────

export const RECENT_LABELS_KEY = "jbk:photo-markup-labels";
export const RECENT_LABELS_MAX = 5;
export type LabelKind = "text" | "tag";

/** The list after one more use: newest first, no duplicates, at most RECENT_LABELS_MAX. */
export function pushRecentLabel(list: readonly string[], label: string): string[] {
  const l = label.trim();
  if (!l) return [...list];
  return [l, ...list.filter((x) => x !== l)].slice(0, RECENT_LABELS_MAX);
}

/** Both lists as stored; empty for anything missing, junk or unreadable (junk is overwritten on the next write). */
function readLabelLists(storage: StorageLike): Record<LabelKind, string[]> {
  const empty: Record<LabelKind, string[]> = { text: [], tag: [] };
  try {
    const raw = storage.getItem(RECENT_LABELS_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;
    const p = parsed as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .slice(0, RECENT_LABELS_MAX)
        : [];
    return { text: strings(p["text"]), tag: strings(p["tag"]) };
  } catch {
    return empty;
  }
}

/** The last labels of that kind on this device, newest first; none when nothing is readable. */
export function readRecentLabels(
  storage: StorageLike | null | undefined,
  kind: LabelKind,
): string[] {
  if (!storage) return [];
  return readLabelLists(storage)[kind];
}

/** Remember one more label of that kind; a storage that refuses is ignored. */
export function rememberLabel(
  storage: StorageLike | null | undefined,
  kind: LabelKind,
  label: string,
) {
  if (!storage) return;
  const lists = readLabelLists(storage);
  lists[kind] = pushRecentLabel(lists[kind], label);
  try {
    storage.setItem(RECENT_LABELS_KEY, JSON.stringify(lists));
  } catch {
    // Private mode / blocked site data: the chips simply do not show next time.
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
