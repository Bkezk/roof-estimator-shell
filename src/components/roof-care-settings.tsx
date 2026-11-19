/**
 * Admin › Settings › Roof Care plans (owner, Nov 18; docs/roof-care-plans.md).
 *
 * The owner's costing sheet as a page: what the crew costs, what each plan charges, how long a
 * roof of each size takes. Under them, the same profit table the sheet shows, and "Try a
 * building": an address and a roof size give the drive from the office and the price of each
 * plan at that drive, which is what the sheet could not do.
 *
 * Every box starts blank and a blank is "not typed". Nothing is priced from a missing number:
 * the page lists what is missing instead. Admins only (the gate, the server and the database).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-store";
import { NOT_PLACED_LINE, placedRoughly, roughPlaceLine } from "@/lib/roof-care-locate";

import {
  draftFrom,
  draftKey,
  HOURS_FIELDS,
  PLAN_FIELDS,
  readBox,
  settingsFromDraft,
  type HoursField,
  type PlanField,
  type RoofCareDraft,
} from "@/lib/roof-care-form";
import {
  money0,
  PLAN_KEYS,
  PLAN_NAMES,
  roofCareQuote,
  SETTING_LABELS,
  settingsProblems,
  TABLE_SIZES_DEFAULT,
  type Drive,
  type PlanKey,
  type RoofCareQuote,
  type RoofCareSettings,
  type SettingKey,
} from "@/lib/roof-care-price";
import {
  getRoofCareSettings,
  roofCareDrive,
  saveRoofCareSettings,
  type RoofCareDrive,
} from "@/lib/roof-care.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KEY = ["roof-care-settings"] as const;

const GROUPS: { title: string; keys: SettingKey[] }[] = [
  {
    title: "Labor and travel",
    keys: [
      "crew_cost_per_hour",
      "crew_size",
      "baseline_drive_hours",
      "baseline_miles",
      "vehicle_cost_per_mile",
      "report_cost_per_visit",
    ],
  },
  {
    title: "Repairs and extras",
    keys: [
      "repair_cost_pct",
      "allowance_used_pct",
      "guard_leak_calls",
      "guard_hours_per_leak_call",
      "guard_storm_inspections",
      "guard_forecast_cost",
      "custom_quote_over_sqft",
      "min_price_sqft",
    ],
  },
];
const PLAN_FIELD_LABELS: Record<PlanField, string> = {
  base: "Base price a year ($)",
  per_sqft: "Price per sq ft a year ($)",
  allowance: "Minor repairs included a year ($)",
};
const HOURS_LABELS: Record<HoursField, string> = {
  sqft: "Roof size (sq ft)",
  inspection: "Inspection (hours)",
  drains: "Drains and scuppers (hours)",
  gutters: "Gutters (hours)",
};
const BOX = "h-10 text-base md:h-9 md:text-sm";

/** One number box: text as typed, red when it is not a number. */
function Box(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const bad = !readBox(props.value).ok;
  return (
    <Input
      id={props.id}
      inputMode="decimal"
      autoComplete="off"
      className={`${BOX} ${bad ? "border-destructive" : ""}`}
      aria-label={props.label}
      aria-invalid={bad}
      disabled={props.disabled}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function RoofCareSettingsPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getRoofCareSettings);
  const saveFn = useServerFn(saveRoofCareSettings);
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => getFn(),
    enabled: !!session,
    refetchOnWindowFocus: false,
  });
  if (q.error)
    return (
      <p className="text-sm text-destructive">
        Could not load the Roof Care plan numbers: {errText(q.error)}
      </p>
    );
  if (!q.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  return (
    <Editor
      // A save hands back the stored numbers: the boxes start again from them.
      key={q.data.updated_at ?? "new"}
      saved={q.data.settings}
      savedLine={
        q.data.updated_at
          ? `Last saved ${new Date(q.data.updated_at).toLocaleString("en-US", {
              timeZone: "America/New_York",
              dateStyle: "medium",
              timeStyle: "short",
            })}${q.data.updated_by_name ? ` · ${q.data.updated_by_name}` : ""}`
          : "Nothing saved yet"
      }
      onSave={async (s) => {
        const r = await saveFn({ data: s });
        qc.setQueryData(KEY, r);
      }}
    />
  );
}

function Editor(props: {
  saved: RoofCareSettings;
  savedLine: string;
  onSave: (s: RoofCareSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RoofCareDraft>(() => draftFrom(props.saved));
  const [savedKey] = useState(() => draftKey(draftFrom(props.saved)));
  const dirty = draftKey(draft) !== savedKey;
  const read = useMemo(() => settingsFromDraft(draft), [draft]);
  // What stops a price: a box that is not a number, then a number still missing.
  const missing = useMemo(
    () => (read.problems.length ? read.problems : settingsProblems(read.settings)),
    [read],
  );
  const save = useMutation({
    mutationFn: () => props.onSave(read.settings),
    onSuccess: () => toast.success("Roof Care plan numbers saved"),
    onError: (e) => toast.error(`Could not save the Roof Care plan numbers: ${errText(e)}`),
  });
  const setValue = (k: SettingKey, v: string) =>
    setDraft((d) => ({ ...d, values: { ...d.values, [k]: v } }));
  const setPlan = (p: PlanKey, f: PlanField, v: string) =>
    setDraft((d) => ({ ...d, plans: { ...d.plans, [p]: { ...d.plans[p], [f]: v } } }));
  const setHours = (i: number, f: HoursField, v: string) =>
    setDraft((d) => ({
      ...d,
      hours: d.hours.map((row, n) => (n === i ? { ...row, [f]: v } : row)),
    }));

  return (
    <div className="space-y-6 pb-24" data-roof-care-settings>
      <div className="grid gap-6 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle className="text-base">{g.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {g.keys.map((k) => (
                <div key={k} className="grid grid-cols-[1fr_7rem] items-center gap-3">
                  <Label htmlFor={`rc-${k}`} className="font-normal">
                    {SETTING_LABELS[k]}
                  </Label>
                  <Box id={`rc-${k}`} value={draft.values[k]} onChange={(v) => setValue(k, v)} />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan prices</CardTitle>
          <CardDescription>
            The list price is the base plus the price per square foot. It covers the round trip
            typed above. A building further away pays more, worked out below.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          {PLAN_KEYS.map((p) => (
            <div key={p} className="space-y-3" data-plan={p}>
              <p className="font-semibold">{PLAN_NAMES[p]}</p>
              {PLAN_FIELDS.filter((f) => !(p === "watch" && f === "allowance")).map((f) => (
                <div key={f} className="space-y-1">
                  <Label htmlFor={`rc-${p}-${f}`} className="font-normal">
                    {PLAN_FIELD_LABELS[f]}
                  </Label>
                  <Box
                    id={`rc-${p}-${f}`}
                    value={draft.plans[p][f]}
                    onChange={(v) => setPlan(p, f, v)}
                  />
                </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hours on site per visit</CardTitle>
          <CardDescription>
            A roof between two sizes takes the hours in between. Smaller than the first row takes
            the first row’s hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  {HOURS_FIELDS.map((f) => (
                    <th key={f} className="pb-2 pr-3 font-medium">
                      {HOURS_LABELS[f]}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {draft.hours.map((row, i) => (
                  <tr key={i} data-hours-row={i}>
                    {HOURS_FIELDS.map((f) => (
                      <td key={f} className="pb-2 pr-3">
                        <Box
                          id={`rc-hours-${i}-${f}`}
                          label={`${HOURS_LABELS[f]}, row ${i + 1}`}
                          value={row[f]}
                          onChange={(v) => setHours(i, f, v)}
                        />
                      </td>
                    ))}
                    <td className="pb-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() =>
                          setDraft((d) => ({ ...d, hours: d.hours.filter((_, n) => n !== i) }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                hours: [...d.hours, { sqft: "", inspection: "", drains: "", gutters: "" }],
              }))
            }
          >
            <Plus className="h-4 w-4" /> Add a roof size
          </Button>
        </CardContent>
      </Card>

      {missing.length > 0 ? (
        <Card className="border-amber-300 dark:border-amber-700" data-roof-care-missing>
          <CardHeader>
            <CardTitle className="text-base">No price can be worked out yet</CardTitle>
            <CardDescription>Fill these in first. A blank is never read as zero.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <>
          <ProfitTable settings={read.settings} />
          <TryABuilding settings={read.settings} />
        </>
      )}

      {/* Save stays at the bottom of the window while the page is scrolled. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-[var(--sidebar-width,0px)]"
        data-save-bar
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" data-save-line>
            {read.problems.length
              ? "A box is not a number. Fix it to save."
              : dirty
                ? "Unsaved changes. The tables below already use what is typed."
                : props.savedLine}
          </p>
          <Button
            type="button"
            className="h-10 min-w-28"
            disabled={!dirty || read.problems.length > 0 || save.isPending}
            onClick={() => save.mutate()}
            data-action="save-roof-care"
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One row of prices: per plan the price, JBK's cost and the profit. Red when a plan loses money. */
function QuoteCells({ quote }: { quote: RoofCareQuote }) {
  return (
    <>
      {quote.plans.map((p) => (
        <td key={p.plan} className="py-2 pr-4 align-top" data-plan-cell={p.plan}>
          <span className="block font-semibold" data-price>
            {money0(p.price)}
          </span>
          <span className="block text-xs text-muted-foreground">
            cost {money0(p.cost)} ·{" "}
            <span className={p.profit < 0 ? "font-semibold text-destructive" : ""} data-profit>
              profit {money0(p.profit)}
            </span>
          </span>
        </td>
      ))}
    </>
  );
}

function ProfitTable({ settings }: { settings: RoofCareSettings }) {
  const rows = TABLE_SIZES_DEFAULT.map((sqft) => ({
    sqft,
    quote: roofCareQuote(settings, { sqft }).quote,
  }));
  return (
    <Card data-roof-care-table>
      <CardHeader>
        <CardTitle className="text-base">Profit per plan, per year</CardTitle>
        <CardDescription>
          At the round trip the list price covers. Red means the plan loses money.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Roof size</th>
              {PLAN_KEYS.map((p) => (
                <th key={p} className="pb-2 pr-4 font-medium">
                  {PLAN_NAMES[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sqft} className="border-t" data-size={r.sqft}>
                <td className="py-2 pr-4 align-top font-medium">
                  {r.sqft.toLocaleString("en-US")} sq ft
                </td>
                {r.quote && !r.quote.custom_quote ? (
                  <QuoteCells quote={r.quote} />
                ) : (
                  <td colSpan={3} className="py-2 text-muted-foreground">
                    Custom quote
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function TryABuilding({ settings }: { settings: RoofCareSettings }) {
  const driveFn = useServerFn(roofCareDrive);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [sqft, setSqft] = useState("");
  const [drive, setDrive] = useState<RoofCareDrive | null | "none">(null);
  const find = useMutation({
    mutationFn: () => driveFn({ data: { address, city, state, zip } }),
    onSuccess: (d) => setDrive(d ?? "none"),
    onError: (e) => {
      setDrive(null);
      toast.error(`Could not work out the drive: ${errText(e)}`);
    },
  });
  const size = readBox(sqft);
  const usable: Drive | null = drive && drive !== "none" ? drive : null;
  const result =
    size.ok && size.value != null && usable
      ? roofCareQuote(settings, { sqft: size.value, drive: usable })
      : null;
  const baseline = `${settings.baseline_drive_hours ?? 0} h and ${settings.baseline_miles ?? 0} miles`;
  return (
    <Card data-roof-care-try>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4" /> Try a building
        </CardTitle>
        <CardDescription>
          The price of each plan at the building’s own drive from the office. Nothing is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_5rem_6rem_8rem]">
          {(
            [
              ["rc-try-address", "Street address", address, setAddress],
              ["rc-try-city", "City", city, setCity],
              ["rc-try-state", "State", state, setState],
              ["rc-try-zip", "Zip", zip, setZip],
            ] as const
          ).map(([id, label, value, set]) => (
            <div key={id} className="space-y-1">
              <Label htmlFor={id}>{label}</Label>
              <Input
                id={id}
                className={BOX}
                value={value}
                onChange={(e) => {
                  set(e.target.value);
                  // A changed address has no drive until it is worked out again.
                  setDrive(null);
                }}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="rc-try-sqft">Roof size (sq ft)</Label>
            <Box id="rc-try-sqft" value={sqft} onChange={setSqft} />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={address.trim().length < 3 || find.isPending}
          onClick={() => find.mutate()}
          data-action="roof-care-drive"
        >
          {find.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Work out the drive
        </Button>
        {drive === "none" && (
          <p className="text-destructive" data-try-line="not-found">
            {NOT_PLACED_LINE}
          </p>
        )}
        {drive && drive !== "none" && placedRoughly(drive.placed_by) && (
          <p className="text-amber-700 dark:text-amber-400" data-try-line="rough">
            {roughPlaceLine(drive.place)}
          </p>
        )}
        {usable && (
          <p data-try-line="drive">
            Round trip from the office: <b>{usable.hours} h</b>, <b>{usable.miles} miles</b>{" "}
            <span className="text-muted-foreground">
              ({(drive as RoofCareDrive).source === "routed" ? "by road" : "estimated"}). The list
              price covers {baseline}.
            </span>
          </p>
        )}
        {usable && !(size.ok && size.value != null) && (
          <p className="text-muted-foreground">Type the roof size to see the prices.</p>
        )}
        {result && !result.quote && (
          <ul className="list-disc pl-5 text-destructive">
            {result.problems.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {result?.quote?.custom_quote && (
          <p data-try-line="custom">
            A roof this size gets a custom quote. No plan price is shown to the customer.
          </p>
        )}
        {result?.quote && !result.quote.custom_quote && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm" data-try-table>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Plan</th>
                  <th className="pb-2 pr-4 font-medium">List price</th>
                  <th className="pb-2 pr-4 font-medium">Added for the drive</th>
                  <th className="pb-2 pr-4 font-medium">Price a year</th>
                  <th className="pb-2 pr-4 font-medium">Billed at each visit</th>
                  <th className="pb-2 pr-4 font-medium">Cost</th>
                  <th className="pb-2 font-medium">Profit</th>
                </tr>
              </thead>
              <tbody>
                {result.quote.plans.map((p) => (
                  <tr key={p.plan} className="border-t" data-try-plan={p.plan}>
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    <td className="py-2 pr-4">{money0(p.list)}</td>
                    <td className="py-2 pr-4">
                      {p.travel > 0 ? `${money0(p.travel)} (${p.trips} trips)` : "Nothing"}
                    </td>
                    <td className="py-2 pr-4 font-semibold">{money0(p.price)}</td>
                    <td className="py-2 pr-4">
                      {money0(p.per_visit[0])}
                      {p.per_visit[1] !== p.per_visit[0] ? ` then ${money0(p.per_visit[1])}` : ""}
                    </td>
                    <td className="py-2 pr-4">{money0(p.cost)}</td>
                    <td className={`py-2 ${p.profit < 0 ? "font-semibold text-destructive" : ""}`}>
                      {money0(p.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
