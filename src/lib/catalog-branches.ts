/**
 * The pricing_catalog branches Estimate Pricing edits, and what each is called (owner, Oct 26–27:
 * the accessory families). Until then the item-number map, the Item Numbers tab and the price
 * import knew one branch, `duro_last`; now a Firestone or Duro-Tech item number can point at a
 * cell on the Non-DL TPO Accessories (`non_dl_tpo`) and EPDM Accessories (`epdm`) screens, and
 * at Non Duro-Last › Preset Custom Applications, and a price-list upload updates those rows by
 * item number like the Duro-Last ones (owner, Oct 27, question 8). Pure: shared by the server
 * functions, the editors and their tests.
 */
export const PRICE_TARGET_BRANCHES = ["duro_last", "non_dl", "non_dl_tpo", "epdm"] as const;
export type CatalogBranch = (typeof PRICE_TARGET_BRANCHES)[number];

/** The menu / page title of each branch, as Estimate Pricing shows it. */
export const BRANCH_LABELS: Record<CatalogBranch, string> = {
  duro_last: "Duro-Last Pricing",
  non_dl: "Non Duro-Last Pricing",
  non_dl_tpo: "Non-DL TPO Accessories",
  epdm: "EPDM Accessories",
};

/** The pages of the two family branches (sidebar: under Non Duro-Last Pricing). */
export const NON_DL_TPO_PATH = "/admin/non-dl-tpo";
export const EPDM_PATH = "/admin/epdm";

export const isCatalogBranch = (branch: string): branch is CatalogBranch =>
  (PRICE_TARGET_BRANCHES as readonly string[]).includes(branch);

/** `<branch>:<screen>` → the branch (an unknown shape is its own "branch", shown as is). */
export const branchOfScreen = (screenId: string): string => {
  const i = screenId.indexOf(":");
  return i > 0 ? screenId.slice(0, i) : screenId;
};

export const branchLabel = (branch: string): string =>
  isCatalogBranch(branch) ? BRANCH_LABELS[branch] : branch;

/**
 * Whether a branch's screens carry item numbers: the Item # column on its rows, a place in the
 * Item Numbers tab, a target for the price import. The four pricing branches do; a branch the
 * app does not know does not.
 */
export const hasItemNumbers = (branch: string): boolean => isCatalogBranch(branch);

/**
 * A screen id as the import history and the tab headers print it: a Duro-Last screen by its
 * slug as before ("sealants"), any other branch prefixed with its page ("EPDM Accessories ›
 * sealants"), so a row written on a family screen is never mistaken for the Duro-Last one.
 */
export function screenTitle(screenId: string): string {
  const branch = branchOfScreen(screenId);
  const slug = screenId.slice(branch.length + 1) || screenId;
  return branch === "duro_last" || !isCatalogBranch(branch)
    ? slug
    : `${BRANCH_LABELS[branch]} › ${slug}`;
}

/** The order the branches are listed in: as PRICE_TARGET_BRANCHES, unknown ones last. */
export const branchOrder = (branch: string): number => {
  const i = (PRICE_TARGET_BRANCHES as readonly string[]).indexOf(branch);
  return i < 0 ? PRICE_TARGET_BRANCHES.length : i;
};

/**
 * Anything keyed by a screen id, grouped by branch in menu order — the Item Numbers tab's
 * headers and the target picker's option groups. The items keep their order inside a group.
 */
export function groupByBranch<T extends { screen_id: string }>(
  items: readonly T[],
): Array<{ branch: string; label: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const b = branchOfScreen(it.screen_id);
    const arr = groups.get(b);
    if (arr) arr.push(it);
    else groups.set(b, [it]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => branchOrder(a) - branchOrder(b))
    .map(([branch, its]) => ({ branch, label: branchLabel(branch), items: its }));
}
