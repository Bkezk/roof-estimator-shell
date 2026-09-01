/**
 * Proposal pricing (Phase 7) — turns the internal cost breakdown into a customer-facing GROUPED
 * price summary. The engine's grand total already includes markup, commission and tax; a customer
 * proposal must NOT expose those internal lines. So we distribute the single real grand total across
 * a few scope groups in proportion to each group's cost, and never show a markup/commission line.
 *
 * The allocation is a presentation choice (a price-per-scope-area), not a claimed engine value —
 * but it is penny-exact: the group prices always sum to the real grand total.
 */

export interface ProposalGroup {
  label: string;
  price: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Distribute `grandTotal` across cost-weighted groups so the returned prices sum EXACTLY to it.
 * Zero-/negative-cost groups are dropped. Any rounding remainder lands on the largest group. When
 * every group has zero cost but there is a total, a single "Total" group carries it.
 */
export function allocateProposalPricing(
  grandTotal: number,
  groupCosts: Array<{ label: string; cost: number }>,
): ProposalGroup[] {
  const nonzero = groupCosts.filter((g) => g.cost > 0);
  const totalCost = nonzero.reduce((s, g) => s + g.cost, 0);
  if (totalCost <= 0) {
    return grandTotal !== 0 ? [{ label: "Total", price: round2(grandTotal) }] : [];
  }
  const groups = nonzero.map((g) => ({
    label: g.label,
    price: round2((grandTotal * g.cost) / totalCost),
  }));
  const remainder = round2(grandTotal - groups.reduce((s, g) => s + g.price, 0));
  if (remainder !== 0) {
    let largest = 0;
    for (let i = 1; i < groups.length; i++)
      if (groups[i]!.price > groups[largest]!.price) largest = i;
    groups[largest]!.price = round2(groups[largest]!.price + remainder);
  }
  return groups;
}

/** The primitive cost drivers a proposal groups by (all in dollars unless noted). */
export interface ProposalCostInputs {
  grandTotal: number;
  membraneMaterial: number;
  installLaborHours: number;
  setupHours: number;
  inspectionHours: number;
  tearOffLaborHours: number;
  accessoryMaterial: number;
  accessoryLaborHours: number;
  parapetMaterial?: number;
  parapetLaborHours?: number;
  curbLaborHours?: number;
  metalsMaterial?: number;
  metalsLabor?: number; // dollars (metals labor bills at each line's own rate)
  underlaymentMaterial: number;
  underlaymentLaborHours?: number;
  adhesiveMaterial?: number;
  warrantyCost: number;
  freight: number;
  nonDlMaterial: number;
  nonDlServices: number;
  crewRate: number; // $/hr, to value the labor-hour drivers
}

/** Build the customer-facing grouped price summary (scope groups → allocated prices). */
export function buildProposalPricing(i: ProposalCostInputs): ProposalGroup[] {
  const groups = [
    {
      label: "Roofing system & installation",
      cost:
        i.membraneMaterial + (i.installLaborHours + i.setupHours + i.inspectionHours) * i.crewRate,
    },
    { label: "Tear-off & disposal", cost: i.tearOffLaborHours * i.crewRate },
    {
      label: "Parapet walls",
      cost: (i.parapetMaterial ?? 0) + (i.parapetLaborHours ?? 0) * i.crewRate,
    },
    { label: "Curbs & penetrations", cost: (i.curbLaborHours ?? 0) * i.crewRate },
    { label: "Metals & drainage", cost: (i.metalsMaterial ?? 0) + (i.metalsLabor ?? 0) },
    {
      label: "Underlayment & insulation",
      cost:
        i.underlaymentMaterial +
        (i.underlaymentLaborHours ?? 0) * i.crewRate +
        (i.adhesiveMaterial ?? 0),
    },
    { label: "Accessories", cost: i.accessoryMaterial + i.accessoryLaborHours * i.crewRate },
    { label: "Additional work", cost: i.nonDlMaterial + i.nonDlServices },
    { label: "Warranty", cost: i.warrantyCost },
    { label: "Freight & delivery", cost: i.freight },
  ];
  return allocateProposalPricing(i.grandTotal, groups);
}
