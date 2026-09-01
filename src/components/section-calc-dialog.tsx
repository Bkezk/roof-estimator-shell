import { Calculator } from "lucide-react";

import { sectionLayers, type BidSectionInput } from "@/lib/engine/bid-builder";
import { areaWithEdgeOverlap } from "@/lib/engine/quantities";
import { priceMatrixLookup, membraneMaterialCost } from "@/lib/engine/pricing";
import { CURRENT_FORMULAS_VERSION } from "@/lib/engine/version";
import {
  TEAROFF_DECK_BY_LABOR_DECK,
  UNDERLAYMENT_DECK_BY_LABOR_DECK,
  underlaymentMechanicalHours,
  underlaymentAdhesive,
  type EngineAdminData,
} from "@/lib/engine/adapters";
import { edgesArpSqFt, perimeterFromEdges } from "@/lib/engine/edges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const sf = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} sf`;

/**
 * "Show calculations" — the legacy Roof Sections calculation-trace window, modernized. Recomputes
 * this section's builder-side figures with the exact same engine helpers the bid total uses, so the
 * trace can never disagree with the estimate.
 */
export function SectionCalcDialog({
  section: s,
  admin,
  roofSystem,
}: {
  section: BidSectionInput;
  admin: EngineAdminData;
  roofSystem: string;
}) {
  const version = CURRENT_FORMULAS_VERSION;
  const roofArea = s.length * s.width;
  const membraneWithOverlap = areaWithEdgeOverlap(s.length, s.width, version);
  const price = priceMatrixLookup(admin.priceMatrix, s.thickness, "rollGoods", s.color);
  const membraneCost = membraneMaterialCost(
    membraneWithOverlap,
    price ?? 0,
    roofSystem === "Duro-Roof",
  );
  const perimLen = s.edges?.length ? perimeterFromEdges(s.edges) : s.perimLengthFt;
  const perimArea = perimLen * s.enhancementWidthFt;
  const cornerArea = s.cornerLengthFt * s.enhancementWidthFt;
  const fieldArea = Math.max(0, roofArea - perimArea - cornerArea);
  const arp = edgesArpSqFt(s.edges ?? []);

  const tDeck = TEAROFF_DECK_BY_LABOR_DECK[s.deckType] ?? s.deckType;
  const tearOffRate = s.tearOff ? (admin.tearOff?.lookup[tDeck]?.[s.tearOffType] ?? 0) : 0;

  const uDeck = UNDERLAYMENT_DECK_BY_LABOR_DECK[s.deckType] ?? s.deckType;
  const layers = sectionLayers(s).map((layer) => {
    const uPrice = admin.underlaymentPrices?.[layer.board];
    const row: {
      label: string;
      material: number | null;
      hours: number | null;
      extra: string;
    } = { label: `${layer.board} (${layer.attachment})`, material: null, hours: null, extra: "" };
    if (uPrice !== undefined) row.material = roofArea * uPrice;
    if (layer.attachment === "mechanical") {
      const layout = admin.underlaymentLabor?.layoutHoursByProduct[layer.board];
      const minPerFast = admin.underlaymentLabor?.fastenerMinutesByDeck[uDeck];
      if (layout !== undefined && minPerFast !== undefined) {
        const count = layer.fastenersPerBoard > 0 ? layer.fastenersPerBoard : 5;
        row.hours = underlaymentMechanicalHours({
          areaSqFt: roofArea,
          layoutHoursPer2500: layout,
          minutesPerFastener: minPerFast,
          fastenersPerBoard: count,
        });
        row.extra = `${Math.ceil(roofArea / 32).toLocaleString()} boards · ${Math.ceil(
          (count / 32) * roofArea,
        ).toLocaleString()} fasteners`;
      }
    } else {
      const entry = admin.adhesiveTimes?.bySubstrate[layer.adhesiveName]?.[layer.substrate];
      if (entry && entry.coverageSqFt > 0) {
        const a = underlaymentAdhesive({
          areaSqFt: roofArea,
          coverageSqFt: entry.coverageSqFt,
          laborPer1000SqFt: entry.labor,
        });
        row.hours = a.hours;
        row.extra = `${a.units.toFixed(2)} units of ${layer.adhesiveName}`;
      }
    }
    return row;
  });

  const line = (label: string, value: string) => (
    <div className="flex justify-between gap-6 border-b border-muted py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Calculator className="mr-1 h-4 w-4" /> Show calculations
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Calculations — {s.name}</DialogTitle>
          <DialogDescription>
            Computed with the same engine formulas the bid total uses (v{version}).
          </DialogDescription>
        </DialogHeader>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Areas
          </p>
          {line(`Roof area (${s.length} × ${s.width})`, sf(roofArea))}
          {line("Membrane with edge overlap", sf(membraneWithOverlap))}
          {perimArea > 0 &&
            line(`Perimeter zone (${perimLen} ft × ${s.enhancementWidthFt} ft)`, sf(perimArea))}
          {cornerArea > 0 &&
            line(
              `Corner zone (${s.cornerLengthFt} ft × ${s.enhancementWidthFt} ft)`,
              sf(cornerArea),
            )}
          {line("Field area (after zones)", sf(fieldArea))}
          {arp > 0 && line("ARP (§2.3, subtracted from membrane)", sf(arp))}

          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Membrane material
          </p>
          {line(
            `Price (${s.thickness} mil ${s.color}, roll goods)`,
            price !== null ? `${money(price)} / sf` : "no price found",
          )}
          {line("Membrane material", money(membraneCost))}

          {s.tearOff && (
            <>
              <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tear-off
              </p>
              {line(`Rate (${tDeck} / ${s.tearOffType || "—"})`, `${tearOffRate} h/sf`)}
              {line("Tear-off labor (before rounding)", `${(roofArea * tearOffRate).toFixed(2)} h`)}
            </>
          )}

          {layers.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Insulation layers
              </p>
              {layers.map((l, i) => (
                <div key={i} className="border-b border-muted py-1 text-sm">
                  <div className="flex justify-between gap-6">
                    <span className="text-muted-foreground">{l.label}</span>
                    <span className="text-right tabular-nums">
                      {l.material !== null ? money(l.material) : "no price"}
                      {l.hours !== null ? ` · ${l.hours.toFixed(2)} h` : ""}
                    </span>
                  </div>
                  {l.extra && <div className="text-xs text-muted-foreground">{l.extra}</div>}
                </div>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
