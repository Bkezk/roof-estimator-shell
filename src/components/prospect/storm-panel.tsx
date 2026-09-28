/**
 * Storm call points on the Buildings page (owner, Sep 28: "just if there's been a major weather
 * event in the past week so that they are potential call points"). A compact card at the top of
 * the find-buildings panel: the window's NOAA hail / wind / tornado reports by county, how many
 * buildings they flagged, a by-hand refresh, and (admins) the thresholds.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { CloudLightning, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";

import {
  refreshStormsIfDue,
  setStormSettings,
  stormSummary,
  type StormCountyRow,
  type StormSettingsInput,
  type StormSettingsRow,
} from "@/lib/storms.functions";
import { stormDay } from "@/components/prospect/storm-format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";

export const STORM_SUMMARY_KEY = ["storm-summary"] as const;

/** "3 hail (max 1.75″), 2 wind, 1 tornado". */
function countySummary(c: StormCountyRow): string {
  const parts: string[] = [];
  if (c.hail)
    parts.push(
      `${c.hail} hail${c.max_hail_in != null ? ` (max ${c.max_hail_in.toFixed(2).replace(/\.?0+$/, "")}″)` : ""}`,
    );
  if (c.wind)
    parts.push(`${c.wind} wind${c.max_wind_mph != null ? ` (max ${c.max_wind_mph} mph)` : ""}`);
  if (c.tornado) parts.push(`${c.tornado} tornado${c.tornado === 1 ? "" : "es"}`);
  return parts.join(", ");
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Draft = {
  window_days: number;
  min_hail_in: number;
  min_wind_mph: number;
  hail_radius_mi: number;
  wind_radius_mi: number;
  tornado_radius_mi: number;
};
const FIELDS: {
  key: keyof Draft;
  label: string;
  min: number;
  max: number;
  step: string;
  int?: boolean;
}[] = [
  { key: "window_days", label: "Window (days)", min: 1, max: 30, step: "1", int: true },
  { key: "min_hail_in", label: "Min hail (in)", min: 0, max: 10, step: "0.25" },
  { key: "min_wind_mph", label: "Min wind (mph)", min: 0, max: 200, step: "1" },
  { key: "hail_radius_mi", label: "Hail radius (mi)", min: 0.25, max: 25, step: "0.25" },
  { key: "wind_radius_mi", label: "Wind radius (mi)", min: 0.25, max: 25, step: "0.25" },
  { key: "tornado_radius_mi", label: "Tornado radius (mi)", min: 0.25, max: 25, step: "0.25" },
];
const draftFrom = (s: StormSettingsRow): Draft => ({
  window_days: Number(s.window_days),
  min_hail_in: Number(s.min_hail_in),
  min_wind_mph: Number(s.min_wind_mph),
  hail_radius_mi: Number(s.hail_radius_mi),
  wind_radius_mi: Number(s.wind_radius_mi),
  tornado_radius_mi: Number(s.tornado_radius_mi),
});

export function StormPanel(props: {
  canWrite: boolean;
  isAdmin: boolean;
  /** A county row was clicked: filter the results to it with Storm hit on. */
  onPickCounty: (county: string) => void;
  /** After a by-hand refresh ran: the building list and anything else storm-derived. */
  onRefreshed?: (() => void) | undefined;
}) {
  const qc = useQueryClient();
  const summaryFn = useServerFn(stormSummary);
  const refreshFn = useServerFn(refreshStormsIfDue);
  const saveFn = useServerFn(setStormSettings);
  const summary = useQuery({ queryKey: STORM_SUMMARY_KEY, queryFn: () => summaryFn() });
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = useMutation({
    mutationFn: () => refreshFn({ data: { force: true } }),
    onSuccess: (r) => {
      if (r.error) toast.error(`Storm refresh: ${r.error}`);
      else toast.success(r.note ?? "Storm reports checked");
      void qc.invalidateQueries({ queryKey: STORM_SUMMARY_KEY });
      if (r.ran) props.onRefreshed?.();
    },
    onError: (e) => toast.error(`Storm refresh failed: ${errText(e)}`),
  });
  const save = useMutation({
    mutationFn: (d: StormSettingsInput) => saveFn({ data: d }),
    onSuccess: () => {
      toast.success("Storm settings saved; they apply from the next refresh");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: STORM_SUMMARY_KEY });
    },
    onError: (e) => toast.error(`Could not save storm settings: ${errText(e)}`),
  });

  const s = summary.data?.settings;
  const days = s?.window_days ?? 7;
  const rows = summary.data?.by_county ?? [];
  const invalid = draft
    ? FIELDS.filter((f) => {
        const v = draft[f.key];
        return !Number.isFinite(v) || v < f.min || v > f.max || (f.int && !Number.isInteger(v));
      })
    : [];
  const submit = () => {
    if (!draft) return;
    if (invalid.length) {
      toast.error(
        `Check the numbers: ${invalid.map((f) => `“${f.label}” must be ${f.min} to ${f.max}`).join("; ")}`,
      );
      return;
    }
    save.mutate(draft);
  };

  return (
    <div className="rounded-lg border p-2 text-sm">
      <div className="flex items-center gap-2">
        <CloudLightning className="h-4 w-4 shrink-0 text-destructive" />
        <span className="font-medium">Storms · last {days} days</span>
        {summary.data && (
          <span className="text-xs text-muted-foreground">
            {summary.data.buildings_flagged.toLocaleString()} building
            {summary.data.buildings_flagged === 1 ? "" : "s"} flagged
          </span>
        )}
      </div>

      {summary.isLoading && <p className="mt-1 text-xs text-muted-foreground">Loading…</p>}
      {summary.error && (
        <p className="mt-1 text-xs text-destructive">
          Could not load storm reports: {errText(summary.error)}
        </p>
      )}
      {summary.data && rows.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          No hail, wind or tornado reports in Kentucky in the last {days} days.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
          {rows.map((c) => (
            <li key={c.county}>
              <button
                type="button"
                className="w-full rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                title={`Show the storm-hit buildings in ${c.county} County`}
                onClick={() => props.onPickCounty(c.county)}
              >
                <span className="font-medium">{c.county}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {c.buildings_hit.toLocaleString()} building{c.buildings_hit === 1 ? "" : "s"}
                  {" · "}
                  {countySummary(c)}
                  {" · "}
                  {stormDay(c.latest)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          {s?.last_fetch_at
            ? `Checked ${formatDistanceToNow(Date.parse(s.last_fetch_at), { addSuffix: true })}`
            : summary.data
              ? "Not checked yet"
              : ""}
          {s?.last_fetch_note ? ` · ${s.last_fetch_note}` : ""}
        </span>
        {props.canWrite && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            title="Pull the latest NOAA storm reports now"
          >
            {refresh.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        )}
        {props.isAdmin && s && (
          <Button
            size="sm"
            variant={draft ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setDraft((d) => (d ? null : draftFrom(s)))}
          >
            <Settings2 className="mr-1 h-3.5 w-3.5" /> Settings
          </Button>
        )}
      </div>

      {props.isAdmin && draft && (
        <div className="mt-2 space-y-2 rounded-md border p-2">
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                <NumberField
                  className="h-8"
                  value={draft[f.key]}
                  min={0}
                  max={f.max}
                  step={f.step}
                  inputMode={f.int ? "numeric" : "decimal"}
                  invalid={invalid.includes(f)}
                  onChange={(v) =>
                    setDraft((d) => (d ? { ...d, [f.key]: f.int ? Math.round(v) : v } : d))
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            A building is flagged when a report at or above the minimum lands within the radius for
            its kind.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
