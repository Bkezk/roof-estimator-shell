/**
 * The Urgent / Emergency badge (owner, Nov 13: "some sort of indicator on that tile"): a word and
 * an icon in red or yellow, never colour alone. One component for the Tech Board's small tiles
 * and the larger cards of My tickets, so a technician's phone and the office's board say it the
 * same way.
 */
import { Siren, TriangleAlert } from "lucide-react";
import { RATE_KIND_LABELS } from "@/lib/invoices.functions";
import type { UrgentRate } from "@/lib/rate-urgency";
import { RATE_TONES } from "@/lib/stage-colors";

const SIZES = {
  /** A Tech Board tile: a 110 px column has to hold it. */
  sm: { box: "gap-0.5 rounded-sm px-1 text-[10px] leading-4", icon: "h-3 w-3" },
  /** A My tickets card, read at arm's length on a roof. */
  lg: { box: "gap-1 rounded px-1.5 py-0.5 text-xs leading-4", icon: "h-4 w-4" },
} as const;

export function RateBadge({ kind, size = "sm" }: { kind: UrgentRate; size?: keyof typeof SIZES }) {
  const Icon = kind === "emergency" ? Siren : TriangleAlert;
  return (
    <span
      data-rate={kind}
      className={`flex w-fit max-w-full items-center border font-bold uppercase tracking-wide ${SIZES[size].box} ${RATE_TONES[kind].badge}`}
    >
      <Icon className={`shrink-0 ${SIZES[size].icon}`} aria-hidden />
      <span className="truncate">{RATE_KIND_LABELS[kind]}</span>
    </span>
  );
}
