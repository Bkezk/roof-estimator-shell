/**
 * A material on a linear (owner, Oct 27: "on the linear other allow a search bar that doesn't
 * have to be filled out that allows someone to search and assign material so that way it can be
 * imported into a bid") — pure, no I/O.
 *
 * `catalogSearchItems` is the one search list: every row the estimator's own pickers can add,
 * from the same sources and with the same keys —
 *  - the Duro-Last accessories catalog (`getAccessoryCatalog` → `buildAccessoryCatalog`, as the
 *    estimator's Accessories › "Extra catalog lines" picker lists it; its labor hours from
 *    `getAccessoryLaborLookup` by the base description, exactly as that picker prefills them),
 *  - the three accessory families' Other Accessories items (`admin.accessoryFamilies.other`, the
 *    Accessories › <group> › Other Accessories pickers; the Duro-Last catalog's own copy of that
 *    screen is left out so each item is listed once, with its hours),
 *  - Exceptional Metals (`getMetalsCatalog`, the Metals picker) and
 *  - the Non-DL catalog (`getNonDlCatalog`, the Non-DL picker).
 * These catalogs are NOT in the engine admin snapshot (`EngineAdminData` keeps only the derived
 * ref data), so the picker reads them with the estimator's own server fns and query keys.
 *
 * `materialLine` is where the bid bills a line's material, by branch — the home the engine
 * actually prices (src/lib/engine/bid-builder.ts):
 *  - "accessories" / "other" → an Other Accessories line (`AccessoryLine`) in the bid's ACTIVE
 *    family group: price × quantity into the accessory material slot, hours × quantity into
 *    crew-rate direct labor (the same path the estimator's Other Accessories picks take);
 *  - "metals" → a flat metals line (`MetalLine`): material into the metals slot, labor at the
 *    row's OWN rate (an Other Accessories line would bill its hours at the crew rate instead);
 *  - "non_dl" → a flat Non-DL catalog line (`NonDlLine` with the row's category): material into
 *    Other Material, labor at the row's own rate (0 = crew rate), routed by category like a line
 *    the estimator adds from the Non-DL picker.
 * Quantity = the line's length in feet (one decimal); the estimator edits it there when the item
 * is priced per roll or each.
 */

import type { AccessoryLine, MetalLine, NonDlLine } from "@/lib/engine/bid-builder";
import type {
  AccessoryCatalogItem,
  MetalsCatalogItem,
  NonDlCatalogItem,
} from "@/lib/engine/adapters";
import {
  FAMILIES,
  FAMILY_BRANCH,
  FAMILY_LABEL,
  OTHER_ACCESSORIES_SCREEN,
  type AdminSnapshot,
} from "@/lib/accessory-families";

import type { LinearMaterial, LinearMaterialBranch } from "./model";

/**
 * One searchable price-list row. `screen` is the row's screen / category exactly as its catalog
 * names it (a Non-DL row's category routes its bid line, so it is kept verbatim); the picker
 * shows it with the branch in front (`categoryLabel`).
 */
export interface CatalogSearchItem {
  key: string;
  branch: LinearMaterialBranch;
  screen: string;
  description: string;
  price: number;
  laborHoursPerUnit?: number;
  /** $/h own-rate labor (Non-DL and metals rows). */
  laborRate?: number;
}

export interface CatalogSources {
  /** The engine admin data (its `accessoryFamilies.other` lists); null while loading. */
  admin: AdminSnapshot | null | undefined;
  accessories: readonly AccessoryCatalogItem[] | null | undefined;
  /** Base description → install hours per unit (`getAccessoryLaborLookup`). */
  accessoryLabor: Record<string, number> | null | undefined;
  metals: readonly MetalsCatalogItem[] | null | undefined;
  nonDl: readonly NonDlCatalogItem[] | null | undefined;
}

/** The accessories catalog's own copy of the Other Accessories screen (listed via the family). */
const DL_OTHER_PREFIX = `${FAMILY_BRANCH.duroLast}:${OTHER_ACCESSORIES_SCREEN}::`;

/** The key of a family's Other Accessories item (`<branch>:other_accessories::<description>`). */
export const otherItemKey = (family: (typeof FAMILIES)[number], description: string): string =>
  `${FAMILY_BRANCH[family]}:${OTHER_ACCESSORIES_SCREEN}::${description}`;

/**
 * Every pickable price-list row, in the estimator's order: accessories catalog, each family's
 * Other Accessories, metals, Non-DL. Sources still loading (null) contribute nothing.
 */
export function catalogSearchItems(src: CatalogSources): CatalogSearchItem[] {
  const out: CatalogSearchItem[] = [];
  for (const a of src.accessories ?? []) {
    if (a.key.startsWith(DL_OTHER_PREFIX)) continue;
    // The estimator's picker: hours by the description without the colour / variant suffix.
    const baseDesc = a.variant ? a.description.slice(0, -` — ${a.variant}`.length) : a.description;
    const hours = src.accessoryLabor?.[baseDesc];
    out.push({
      key: a.key,
      branch: "accessories",
      screen: a.category,
      description: a.description,
      price: a.price,
      ...(hours !== undefined ? { laborHoursPerUnit: hours } : {}),
    });
  }
  const other = src.admin?.accessoryFamilies?.other;
  if (other)
    for (const family of FAMILIES)
      for (const it of other[family])
        out.push({
          key: otherItemKey(family, it.description),
          branch: "other",
          screen: `${FAMILY_LABEL[family]} · Other Accessories`,
          description: it.part ? `${it.description} (${it.part})` : it.description,
          price: it.price,
          laborHoursPerUnit: it.laborHoursPerUnit,
        });
  for (const m of src.metals ?? [])
    out.push({
      key: m.key,
      branch: "metals",
      screen: m.category,
      description: m.description,
      price: m.unitCost,
      laborHoursPerUnit: m.laborPerUnit,
      laborRate: m.laborRate,
    });
  for (const n of src.nonDl ?? [])
    out.push({
      key: n.key,
      branch: "non_dl",
      screen: n.category,
      description: n.description,
      price: n.price,
      laborHoursPerUnit: n.laborPerUnit,
      laborRate: n.laborRate,
    });
  return out;
}

/** The category the picker shows: the branch in front of the screen where that is not obvious. */
export function categoryLabel(it: Pick<CatalogSearchItem, "branch" | "screen">): string {
  return it.branch === "metals"
    ? `Metals · ${it.screen}`
    : it.branch === "non_dl"
      ? `Non-DL · ${it.screen}`
      : it.screen;
}

/** Type-search: every word must appear in the category or description; the first `limit`. */
export function searchCatalog(
  items: readonly CatalogSearchItem[],
  query: string,
  limit = 30,
): CatalogSearchItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: CatalogSearchItem[] = [];
  for (const it of items) {
    const hay = `${categoryLabel(it)} ${it.description}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) {
      out.push(it);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The snapshot a picked item leaves on the linear (no undefined keys in the saved JSON). */
export function materialFromItem(it: CatalogSearchItem): LinearMaterial {
  const m: LinearMaterial = {
    key: it.key,
    description: it.description,
    price: it.price,
    screen: it.screen,
    branch: it.branch,
  };
  if (it.laborHoursPerUnit !== undefined) m.laborHoursPerUnit = it.laborHoursPerUnit;
  if (it.laborRate !== undefined) m.laborRate = it.laborRate;
  return m;
}

/** `material` re-read against the live price list: the live item's figures under the same key. */
export function liveMaterial(
  material: LinearMaterial,
  catalog: readonly CatalogSearchItem[],
): LinearMaterial | null {
  const it = catalog.find((x) => x.key === material.key);
  return it ? materialFromItem(it) : null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const feet = (ft: number) =>
  `${round1(ft).toLocaleString("en-US", { maximumFractionDigits: 1 })} ft`;

/** The bid line's description: "<line name> · <length> — <item description>". */
export const materialLineDescription = (
  name: string,
  lengthFt: number,
  material: LinearMaterial,
): string => `${name} · ${feet(lengthFt)} — ${material.description}`;

/** The line a linear's material becomes on the bid, and the state field that bills it. */
export type MaterialLine =
  | { home: "otherAccessories"; line: AccessoryLine }
  | { home: "metals"; line: MetalLine }
  | { home: "nonDlLines"; line: NonDlLine };

/** Where `branch` bills (see the header). */
export function materialHome(branch: LinearMaterialBranch): MaterialLine["home"] {
  return branch === "metals" ? "metals" : branch === "non_dl" ? "nonDlLines" : "otherAccessories";
}

/** The bid line for `material` on a line of `lengthFt` named `name` (quantity = feet, 1 dp). */
export function materialLine(
  name: string,
  lengthFt: number,
  material: LinearMaterial,
): MaterialLine {
  const description = materialLineDescription(name, lengthFt, material);
  const quantity = round1(lengthFt);
  const home = materialHome(material.branch);
  if (home === "otherAccessories")
    return {
      home,
      line: {
        description,
        price: material.price,
        quantity,
        laborHoursPerUnit: material.laborHoursPerUnit ?? 0,
      },
    };
  const line: NonDlLine = {
    description,
    price: material.price,
    laborPerUnit: material.laborHoursPerUnit ?? 0,
    laborRate: material.laborRate ?? 0,
    quantity,
  };
  if (home === "nonDlLines") return { home, line: { ...line, category: material.screen } };
  return { home, line };
}

/** Where the estimator sees the line, for the notice. */
export function materialHomeLabel(branch: LinearMaterialBranch): string {
  const home = materialHome(branch);
  return home === "metals"
    ? "Metals › Extra catalog lines"
    : home === "nonDlLines"
      ? "Non-DL › Extra catalog lines"
      : "Accessories › Other Accessories (the bid's active group)";
}
