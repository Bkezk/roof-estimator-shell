/**
 * Admin › Settings › Roof Care plans: the page's boxes as TEXT (owner: number boxes start blank,
 * and a blank is "not typed", never 0), and back to the numbers the price engine reads
 * (lib/roof-care-price.ts). Pure, so the rules are tested without the screen.
 */
import {
  PLAN_KEYS,
  SETTING_LABELS,
  type HoursRow,
  type PlanKey,
  type RoofCareSettings,
  type SettingKey,
} from "@/lib/roof-care-price";

export const SETTING_KEYS = Object.keys(SETTING_LABELS) as SettingKey[];
export const PLAN_FIELDS = ["base", "per_sqft", "allowance"] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];
export const HOURS_FIELDS = ["sqft", "inspection", "drains", "gutters"] as const;
export type HoursField = (typeof HOURS_FIELDS)[number];

export interface RoofCareDraft {
  values: Record<SettingKey, string>;
  plans: Record<PlanKey, Record<PlanField, string>>;
  hours: Record<HoursField, string>[];
}

const show = (n: number | null | undefined): string => (n == null ? "" : String(n));

/** The saved numbers as the page's boxes; a number not saved is an empty box. */
export function draftFrom(s: RoofCareSettings): RoofCareDraft {
  const values = {} as Record<SettingKey, string>;
  for (const k of SETTING_KEYS) values[k] = show(s[k]);
  const plans = {} as RoofCareDraft["plans"];
  for (const p of PLAN_KEYS)
    plans[p] = {
      base: show(s.plans[p].base),
      per_sqft: show(s.plans[p].per_sqft),
      allowance: show(s.plans[p].allowance),
    };
  return {
    values,
    plans,
    hours: [...s.hours]
      .sort((a, b) => a.sqft - b.sqft)
      .map((h) => ({
        sqft: show(h.sqft),
        inspection: show(h.inspection),
        drains: show(h.drains),
        gutters: show(h.gutters),
      })),
  };
}

/** What a box holds: blank, a number of 0 or more, or something that is not a number. */
export function readBox(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim().replace(/[$,%\s]/g, "");
  if (t === "") return { ok: true, value: null };
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return { ok: false };
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

export const NOT_A_NUMBER = "Type a number, 0 or more";

/**
 * The draft as settings, with what is wrong in the page's words. A box that is not a number is
 * a problem (it is never read as blank or as 0). A row of the hours table needs all four numbers
 * and a roof size above 0; a row left wholly blank is dropped.
 */
export function settingsFromDraft(d: RoofCareDraft): {
  settings: RoofCareSettings;
  problems: string[];
} {
  const problems: string[] = [];
  const num = (text: string, what: string): number | null => {
    const r = readBox(text);
    if (!r.ok) {
      problems.push(`${what}: ${NOT_A_NUMBER.toLowerCase()}`);
      return null;
    }
    return r.value;
  };
  const values = {} as Record<SettingKey, number | null>;
  for (const k of SETTING_KEYS) values[k] = num(d.values[k], SETTING_LABELS[k]);
  const plans = {} as RoofCareSettings["plans"];
  const words: Record<PlanField, string> = {
    base: "base price",
    per_sqft: "price per sq ft",
    allowance: "repair allowance",
  };
  for (const p of PLAN_KEYS)
    plans[p] = {
      base: num(d.plans[p].base, `${p} ${words.base}`),
      per_sqft: num(d.plans[p].per_sqft, `${p} ${words.per_sqft}`),
      allowance: num(d.plans[p].allowance, `${p} ${words.allowance}`),
    };
  const hours: HoursRow[] = [];
  d.hours.forEach((row, i) => {
    if (HOURS_FIELDS.every((f) => row[f].trim() === "")) return;
    const at = `Hours on site, row ${i + 1}`;
    const sqft = num(row.sqft, `${at}, roof size`);
    const inspection = num(row.inspection, `${at}, inspection`);
    const drains = num(row.drains, `${at}, drains`);
    const gutters = num(row.gutters, `${at}, gutters`);
    if (sqft == null || inspection == null || drains == null || gutters == null) {
      if (HOURS_FIELDS.some((f) => row[f].trim() === ""))
        problems.push(`${at}: fill in all four boxes, or clear the row`);
      return;
    }
    if (sqft <= 0) {
      problems.push(`${at}: the roof size must be more than 0`);
      return;
    }
    hours.push({ sqft, inspection, drains, gutters });
  });
  const sizes = hours.map((h) => h.sqft);
  if (new Set(sizes).size !== sizes.length)
    problems.push("Two rows of Hours on site have the same roof size. Keep one of them.");
  return {
    settings: { ...values, plans, hours: hours.sort((a, b) => a.sqft - b.sqft) },
    problems,
  };
}

/** The same text whatever order the keys were typed in: "unsaved changes" compares these. */
export const draftKey = (d: RoofCareDraft): string => JSON.stringify(d);
