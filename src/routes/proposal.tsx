import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Printer, ArrowLeft } from "lucide-react";

import { getEngineAdminData } from "@/lib/engine.functions";
import { getBid, getCompanyInfo, getWarrantyData } from "@/lib/bids.functions";
import { buildEstimateInputs } from "@/lib/engine/bid-builder";
import { computeEstimate } from "@/lib/engine/estimate";
import { buildProposalPricing } from "@/lib/engine/proposal";
import {
  buildBidInput,
  emptyCustomer,
  resolveBidComputeData,
  type SavedBidState,
} from "@/lib/proposal-bid";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/proposal")({
  head: () => ({ meta: [{ title: "Proposal — Bid-O-Matic" }] }),
  validateSearch: (s: Record<string, unknown>): { bid?: string } => {
    const b = s["bid"];
    return typeof b === "string" ? { bid: b } : {};
  },
  component: ProposalPage,
});

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const today = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/** A short, plain-language scope sentence built from the bid's sections. */
function scopeNarrative(s: SavedBidState): string {
  const totalSqFt = s.sections.reduce((sum, sec) => sum + sec.length * sec.width, 0);
  const thicknesses = [...new Set(s.sections.map((sec) => sec.thickness))].sort((a, b) => a - b);
  const attach = s.attachment === "adhered" ? "fully-adhered" : "mechanically-attached";
  const anyTearOff = s.sections.some((sec) => sec.tearOff);
  const parts = [
    `Furnish and install a ${s.roofSystem} ${thicknesses.join("/")}‑mil ${attach} membrane roof system`,
    `over ${s.sections.length} roof ${s.sections.length === 1 ? "section" : "sections"} totaling ${Math.round(totalSqFt).toLocaleString()} sq ft`,
  ];
  if (anyTearOff) parts.push("including tear-off and disposal of the existing roof");
  return parts.join(" ") + ".";
}

function ProposalPage() {
  const navigate = useNavigate();
  const { bid: bidParam } = Route.useSearch();
  const getBidFn = useServerFn(getBid);
  const getAdminFn = useServerFn(getEngineAdminData);
  const getCompanyFn = useServerFn(getCompanyInfo);
  const getWarrantyFn = useServerFn(getWarrantyData);
  const { session } = useAuth();
  const authed = !!session;

  const { data: bidRow, isLoading: bidLoading } = useQuery({
    queryKey: ["bid", bidParam],
    queryFn: () => getBidFn({ data: { id: bidParam! } }),
    enabled: authed && !!bidParam,
  });
  const { data: admin, isLoading: adminLoading } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getAdminFn(),
    enabled: authed,
  });
  const { data: company } = useQuery({
    queryKey: ["company-info"],
    queryFn: () => getCompanyFn(),
    enabled: authed,
  });
  const { data: warrantyData } = useQuery({
    queryKey: ["warranty-data"],
    queryFn: () => getWarrantyFn(),
    enabled: authed,
  });

  const model = useMemo(() => {
    if (!bidRow || !admin) return null;
    const raw = bidRow.data as unknown as Partial<SavedBidState> | null;
    if (!raw || !Array.isArray(raw.sections)) return null;
    // Spread raw FIRST so every optional field (discounts, per-diem, warranty selection, …) carries
    // through to the same buildBidInput path the estimator uses — the price pin depends on it.
    const saved: SavedBidState = {
      ...(raw as SavedBidState),
      roofSystem: raw.roofSystem ?? "Duro-Last",
      attachment: raw.attachment ?? "mechanical",
      sections: raw.sections,
      accessories: Array.isArray(raw.accessories) ? raw.accessories : [],
      nonDlLines: Array.isArray(raw.nonDlLines) ? raw.nonDlLines : [],
      metals: Array.isArray(raw.metals) ? raw.metals : [],
      parapets: Array.isArray(raw.parapets) ? raw.parapets : [],
      curbs: Array.isArray(raw.curbs) ? raw.curbs : [],
      customer: { ...emptyCustomer(), ...(raw.customer ?? {}) },
      markupMode: (raw.markupMode ?? 2) as SavedBidState["markupMode"],
      markup: raw.markup ?? 0,
      laborRate: raw.laborRate ?? 50,
      commission: raw.commission ?? 0,
      taxExempt: raw.taxExempt ?? false,
    };
    // Frozen pricing: compute against the bid's snapshot when it carries one (same resolver as
    // the estimator, so the proposal price cannot drift), else against live admin data.
    const cd = resolveBidComputeData(saved, admin, warrantyData);
    if (!cd.admin) return null;
    const { inputs, parapetMaterial, metalsMaterial, adhesiveMaterial } = buildEstimateInputs(
      buildBidInput(saved, cd.warranty),
      cd.admin,
    );
    const r = computeEstimate(inputs);

    const accessoryMaterial = saved.accessories.reduce((s, a) => s + a.price * a.quantity, 0);
    const accessoryLaborHours = saved.accessories.reduce(
      (s, a) => s + (a.laborHoursPerUnit ?? 0) * a.quantity,
      0,
    );
    const nonDlMaterial = saved.nonDlLines.reduce((s, l) => s + l.price * l.quantity, 0);
    const metalsLabor = (saved.metals ?? []).reduce(
      (s, m) => s + m.laborPerUnit * m.laborRate * m.quantity,
      0,
    );
    const groups = buildProposalPricing({
      grandTotal: r.money.grandTotal,
      membraneMaterial:
        (r.money.dTotals[0] ?? 0) -
        accessoryMaterial -
        parapetMaterial -
        metalsMaterial -
        adhesiveMaterial,
      installLaborHours: r.installHours,
      setupHours: r.setupHours,
      inspectionHours: r.inspectionHours,
      tearOffLaborHours: r.tearOffLaborHours,
      accessoryMaterial,
      accessoryLaborHours,
      parapetMaterial,
      parapetLaborHours: r.parapetLaborHours,
      curbLaborHours: r.curbLaborHours,
      metalsMaterial,
      metalsLabor,
      underlaymentMaterial: r.money.dTotals[6] ?? 0,
      underlaymentLaborHours: r.underlaymentLaborHours,
      adhesiveMaterial,
      warrantyCost: r.money.dTotals[5] ?? 0,
      freight: r.money.dTotals[9] ?? 0,
      nonDlMaterial,
      nonDlServices: r.laborSubtotal2 - metalsLabor,
      crewRate: saved.laborRate,
    });
    return { saved, r, groups, grandTotal: r.money.grandTotal };
  }, [bidRow, admin, warrantyData]);

  if (!bidParam) {
    return <p className="text-sm text-muted-foreground">No bid selected.</p>;
  }
  if (bidLoading || adminLoading) {
    return <p className="text-sm text-muted-foreground">Preparing proposal…</p>;
  }
  if (!bidRow || !model) {
    return <p className="text-sm text-muted-foreground">Could not load this bid.</p>;
  }

  const { saved, groups, grandTotal } = model;
  const companyLine2 = [company?.city, company?.state, company?.zip].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl">
      {/* Print rules: hide everything except the proposal sheet, then reveal it full-width. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .proposal-sheet, .proposal-sheet * { visibility: visible !important; }
          .proposal-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/estimate", search: { bid: bidParam } })}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to estimator
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
        </Button>
      </div>

      <div className="proposal-sheet rounded-lg border bg-white p-8 text-[13px] leading-relaxed text-neutral-900 shadow-sm">
        {/* Header */}
        <div className="flex items-start justify-between border-b pb-4">
          <div>
            <h1 className="text-xl font-bold">{company?.company_name || "Your Company"}</h1>
            {company?.address && <p>{company.address}</p>}
            {companyLine2 && <p>{companyLine2}</p>}
            {company?.phone && <p>{company.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold uppercase tracking-wide text-neutral-500">
              Proposal
            </p>
            <p>{today()}</p>
            <p className="text-neutral-500">{bidRow.name}</p>
          </div>
        </div>

        {/* Prepared for */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Prepared for
            </p>
            <p className="font-medium">{saved.customer.name || "—"}</p>
            {saved.customer.contact && <p>{saved.customer.contact}</p>}
            {saved.customer.phone && <p>{saved.customer.phone}</p>}
            {saved.customer.email && <p>{saved.customer.email}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Project address
            </p>
            <p>{saved.customer.projectAddress || "—"}</p>
            {saved.customer.jobCityStZip && <p>{saved.customer.jobCityStZip}</p>}
            {saved.customer.jobNumber && (
              <p className="text-neutral-500">Job # {saved.customer.jobNumber}</p>
            )}
          </div>
        </div>

        {/* Scope */}
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Scope of work
          </p>
          <p className="mt-1">{scopeNarrative(saved)}</p>
          {saved.customer.notes && <p className="mt-2">{saved.customer.notes}</p>}
        </div>

        {/* Price summary */}
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Investment
          </p>
          <table className="mt-2 w-full">
            <tbody>
              {groups.map((g) => (
                <tr key={g.label} className="border-b border-neutral-100">
                  <td className="py-1.5">{g.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(g.price)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-neutral-800 font-bold">
                <td className="py-2">Total project price</td>
                <td className="py-2 text-right tabular-nums">{money(grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Terms + signature */}
        <div className="mt-6 text-[12px] text-neutral-600">
          <p>
            This proposal is valid for 30 days. Price includes materials, labor, and applicable
            taxes as described above. Work to be completed in a professional manner according to
            standard practices.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-8">
          <div>
            <div className="border-t border-neutral-400 pt-1 text-xs text-neutral-500">
              Accepted by (customer) &amp; date
            </div>
          </div>
          <div>
            <div className="border-t border-neutral-400 pt-1 text-xs text-neutral-500">
              {company?.company_name || "Company"} representative &amp; date
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
