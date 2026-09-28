/** Small display helpers for the storm call points (shared by the panel and the Buildings page). */
import type { StormSettingsRow } from "@/lib/storms.functions";

/** "Sep 21" from a "2026-09-21" date, read as a local day so it does not shift by time zone. */
export function stormDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The radius (miles) a report of this kind flags buildings within, from the settings. */
export function stormRadius(
  settings: StormSettingsRow | null | undefined,
  kind: string | null | undefined,
): number | null {
  if (!settings || !kind) return null;
  if (kind === "hail") return settings.hail_radius_mi;
  if (kind === "wind") return settings.wind_radius_mi;
  if (kind === "tornado") return settings.tornado_radius_mi;
  return null;
}
