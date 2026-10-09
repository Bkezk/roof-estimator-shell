/**
 * "Find any material" on the close-out's Materials section (owner, Oct 9: "they need to also be
 * able to search materials and add, and when they do that they can assign it from the shop or
 * vehicle"). The truck list only shows what is on the tech's truck; this searches EVERY catalog
 * cell anyone has stocked (listStock, all locations) plus the service material list, so a
 * material nobody has on hand still comes up, and says per result where it can be taken from:
 * my truck first, then the shop, then any other truck that has it. Pure, so it is tested
 * without the screen.
 */
import {
  EPS,
  catalogKey,
  cellName,
  matchesSearch,
  type CatalogCell,
} from "@/components/service/materials-utils";
import type { PieceDef } from "@/lib/stock-units";

/** Fewer characters than this: no search (the stock read is not even made). */
export const SEARCH_MIN_CHARS = 2;
/** The most results shown; a longer query narrows it. */
export const SEARCH_MAX_RESULTS = 12;
/** The shop when the location list has not loaded (inventory.functions.ts SHOP_LOCATION_ID). */
const SHOP_FALLBACK = { id: "shop", name: "Shop" };

/** A listStock row: one cell at one location. */
export interface SearchStock extends CatalogCell {
  location_id: string;
  category: string;
  unit: string;
  /** Packs. */
  on_hand: number;
  item_nos?: string[] | undefined;
}
/** A row this screen already knows the piece / name of (myTruckStock, the elsewhere panel). */
export interface SearchKnown extends CatalogCell {
  label: string | null;
  piece: PieceDef | null;
  item_no: string | null;
  unit: string;
  category: string;
}
/** A service material (listServiceMaterialOptions): no stock needed to be found. */
export interface SearchCatalog extends CatalogCell {
  label: string;
  category: string;
  unit: string;
  piece: PieceDef | null;
  item_no: string | null;
}
export interface SearchLocation {
  id: string;
  name: string;
  kind: "shop" | "vehicle";
}

export interface MaterialSource {
  location_id: string;
  location_name: string;
  kind: "mine" | "shop" | "other";
  /** Packs on hand there, or null when the stock read has not answered (the server checks). */
  on_hand: number | null;
}
export interface MaterialResult extends CatalogCell {
  /** catalogKey: one cell regardless of where it sits. */
  key: string;
  label: string | null;
  category: string;
  unit: string;
  piece: PieceDef | null;
  item_no: string | null;
  sources: MaterialSource[];
}

interface Entry extends CatalogCell {
  key: string;
  label: string | null;
  category: string;
  unit: string;
  piece: PieceDef | null;
  item_no: string | null;
  perLoc: Map<string, number>;
}

/**
 * The results for `query` (≥ 2 characters, else none): every stocked cell and every service
 * material matching it, at most SEARCH_MAX_RESULTS, each with its sources. `stock` null means
 * the stock read has not answered: the sources are still offered, with their on-hand unknown.
 */
export function searchMaterials(
  query: string,
  stock: readonly SearchStock[] | null,
  catalog: readonly SearchCatalog[],
  locations: readonly SearchLocation[],
  myTruckId: string | null,
  known: readonly SearchKnown[] = [],
): MaterialResult[] {
  const q = query.trim();
  if (q.length < SEARCH_MIN_CHARS) return [];

  const entries = new Map<string, Entry>();
  const entry = (c: CatalogCell): Entry => {
    const key = catalogKey(c);
    let e = entries.get(key);
    if (!e) {
      e = {
        key,
        screen_id: c.screen_id,
        row_label: c.row_label,
        price_col: c.price_col,
        label: null,
        category: "",
        unit: "",
        piece: null,
        item_no: null,
        perLoc: new Map(),
      };
      entries.set(key, e);
    }
    return e;
  };
  for (const s of stock ?? []) {
    const e = entry(s);
    e.perLoc.set(s.location_id, (e.perLoc.get(s.location_id) ?? 0) + s.on_hand);
    e.category ||= s.category;
    e.unit ||= s.unit;
    if (!e.item_no && s.item_nos?.length === 1) e.item_no = s.item_nos[0] ?? null;
  }
  for (const c of catalog) {
    const e = entry(c);
    e.label ??= c.label;
    e.category ||= c.category;
    e.unit ||= c.unit;
    e.piece ??= c.piece;
    e.item_no ??= c.item_no;
  }
  // What this screen already knows about a cell (the truck's rows carry the piece definition and
  // the service name) wins over what was derived here.
  const knownBy = new Map<string, SearchKnown>();
  for (const k of known) if (!knownBy.has(catalogKey(k))) knownBy.set(catalogKey(k), k);
  for (const e of entries.values()) {
    const k = knownBy.get(e.key);
    if (!k) continue;
    e.label = k.label ?? e.label;
    e.piece = k.piece ?? e.piece;
    e.item_no = k.item_no ?? e.item_no;
    e.category = k.category || e.category;
    e.unit = k.unit || e.unit;
  }

  const onMine = (e: Entry) => (myTruckId ? (e.perLoc.get(myTruckId) ?? 0) > EPS : false);
  const anywhere = (e: Entry) => [...e.perLoc.values()].some((n) => n > EPS);
  const hits = [...entries.values()]
    .filter((e) => matchesSearch(e, q))
    .sort(
      (a, b) =>
        Number(onMine(b)) - Number(onMine(a)) ||
        Number(anywhere(b)) - Number(anywhere(a)) ||
        cellName(a).localeCompare(cellName(b)),
    )
    .slice(0, SEARCH_MAX_RESULTS);

  const shop = locations.find((l) => l.kind === "shop") ?? SHOP_FALLBACK;
  const nameOf = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
  const onHand = (e: Entry, id: string) => (stock ? (e.perLoc.get(id) ?? 0) : null);
  return hits.map((e) => {
    const sources: MaterialSource[] = [];
    if (myTruckId)
      sources.push({
        location_id: myTruckId,
        location_name: nameOf(myTruckId),
        kind: "mine",
        on_hand: onHand(e, myTruckId),
      });
    if (shop.id !== myTruckId)
      sources.push({
        location_id: shop.id,
        location_name: shop.name,
        kind: "shop",
        on_hand: onHand(e, shop.id),
      });
    for (const l of locations) {
      if (l.kind !== "vehicle" || l.id === myTruckId || l.id === shop.id) continue;
      const n = e.perLoc.get(l.id) ?? 0;
      if (n > EPS)
        sources.push({ location_id: l.id, location_name: l.name, kind: "other", on_hand: n });
    }
    return {
      key: e.key,
      screen_id: e.screen_id,
      row_label: e.row_label,
      price_col: e.price_col,
      label: e.label,
      category: e.category,
      unit: e.unit,
      piece: e.piece,
      item_no: e.item_no,
      sources,
    };
  });
}
