/**
 * Each ticket section's colour (owner, Oct 6: "can you add colors to those drop downs"): a
 * coloured left edge, a tinted header and a coloured icon, light and dark. Keyed by the section's
 * storage key (a review copy — "materials-review", "time-review" — takes its section's colour).
 * Whole class strings so Tailwind keeps them.
 */
export interface SectionTone {
  edge: string;
  head: string;
  icon: string;
}
export const SECTION_TONES: Record<string, SectionTone> = {
  aerial: {
    edge: "border-l-4 border-l-sky-500",
    head: "bg-sky-50 dark:bg-sky-950/40",
    icon: "text-sky-600 dark:text-sky-400",
  },
  inspection: {
    edge: "border-l-4 border-l-violet-500",
    head: "bg-violet-50 dark:bg-violet-950/40",
    icon: "text-violet-600 dark:text-violet-400",
  },
  repairs: {
    edge: "border-l-4 border-l-orange-500",
    head: "bg-orange-50 dark:bg-orange-950/40",
    icon: "text-orange-600 dark:text-orange-400",
  },
  materials: {
    edge: "border-l-4 border-l-emerald-500",
    head: "bg-emerald-50 dark:bg-emerald-950/40",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  "purchase-orders": {
    edge: "border-l-4 border-l-amber-500",
    head: "bg-amber-50 dark:bg-amber-950/40",
    icon: "text-amber-600 dark:text-amber-400",
  },
  time: {
    edge: "border-l-4 border-l-blue-500",
    head: "bg-blue-50 dark:bg-blue-950/40",
    icon: "text-blue-600 dark:text-blue-400",
  },
  closeout: {
    edge: "border-l-4 border-l-teal-500",
    head: "bg-teal-50 dark:bg-teal-950/40",
    icon: "text-teal-600 dark:text-teal-400",
  },
  timeline: {
    edge: "border-l-4 border-l-slate-500",
    head: "bg-slate-50 dark:bg-slate-900/60",
    icon: "text-slate-600 dark:text-slate-300",
  },
  earlier: {
    edge: "border-l-4 border-l-rose-500",
    head: "bg-rose-50 dark:bg-rose-950/40",
    icon: "text-rose-600 dark:text-rose-400",
  },
  invoice: {
    edge: "border-l-4 border-l-indigo-500",
    head: "bg-indigo-50 dark:bg-indigo-950/40",
    icon: "text-indigo-600 dark:text-indigo-400",
  },
};
export function sectionTone(key: string | undefined): SectionTone | undefined {
  return key ? SECTION_TONES[key.replace(/-review$/, "")] : undefined;
}
