/**
 * "Import old bids" — reads legacy Bid-Advantage .bax files in the browser, shows what each one
 * becomes (name, status, total, anything the converter was unsure about) and saves them as bids
 * with their own frozen pricing (the file's price tables over the live catalog — see
 * src/lib/bax/bax-import.ts). Nothing is written until "Import" is pressed.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getEngineAdminData, getFastenerLookup } from "@/lib/engine.functions";
import { getWarrantyData, importBids } from "@/lib/bids.functions";
import { STATUS_LABELS } from "@/lib/bid-status";
import { buildBidInput, type SavedBidState } from "@/lib/proposal-bid";
import { buildEstimateInputs } from "@/lib/engine/bid-builder";
import { computeEstimate } from "@/lib/engine/estimate";
import { readBaxXml } from "@/lib/bax/zip";
import {
  applyLegacyPricing,
  applyLegacyWarranty,
  convertBax,
  parseBax,
  type BaxConversion,
} from "@/lib/bax/bax-import";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

interface Prepared {
  fileName: string;
  conversion: BaxConversion | null;
  payload: SavedBidState | null;
  grandTotal: number;
  error: string | null;
  notes: string[];
}

export function ImportBaxDialog(props: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const getAdminFn = useServerFn(getEngineAdminData);
  const getWarrantyFn = useServerFn(getWarrantyData);
  const getLookupFn = useServerFn(getFastenerLookup);
  const importFn = useServerFn(importBids);
  const { data: liveAdmin } = useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getAdminFn(),
    enabled: props.open,
  });
  const { data: liveWarranty } = useQuery({
    queryKey: ["warranty-data"],
    queryFn: () => getWarrantyFn(),
    enabled: props.open,
  });
  const { data: fastenerLookup } = useQuery({
    queryKey: ["fastener-lookup"],
    queryFn: () => getLookupFn(),
    enabled: props.open,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<Prepared[]>([]);
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [showWarnings, setShowWarnings] = useState<Record<string, boolean>>({});

  const reset = () => {
    setPrepared([]);
    setShowWarnings({});
    if (fileRef.current) fileRef.current.value = "";
  };
  const close = () => {
    if (busy) return;
    reset();
    props.onClose();
  };

  const prepare = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!liveAdmin) {
      toast.error("Still loading the price catalog — try again in a moment.");
      return;
    }
    setBusy("reading");
    const out: Prepared[] = [];
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = parseBax(await readBaxXml(bytes));
        const conversion = convertBax(doc, {
          fileName: file.name,
          fastenerLookup: fastenerLookup ?? [],
          boardNames: Object.keys(liveAdmin.underlaymentPrices ?? {}),
          ...(liveAdmin.laborTemplates?.names
            ? { laborTemplateNames: liveAdmin.laborTemplates.names }
            : {}),
        });
        const pricing = applyLegacyPricing(liveAdmin, doc);
        const warranty = liveWarranty ? applyLegacyWarranty(liveWarranty, doc) : null;
        conversion.importInfo.pricingOverlays = [...pricing.applied, ...(warranty?.applied ?? [])];
        const payload: SavedBidState = {
          ...conversion.saved,
          importInfo: conversion.importInfo,
          adminSnapshot: pricing.admin,
          ...(warranty ? { warrantySnapshot: warranty.warranty } : {}),
          // The snapshot is the legacy file's pricing, so "as of" is its last save.
          pricingAsOf: conversion.lastSavedAt ?? new Date().toISOString(),
        };
        const bidInput = {
          ...buildBidInput(payload, warranty?.warranty ?? liveWarranty ?? null),
          ...(fastenerLookup?.length ? { fastenerLookup } : {}),
        };
        const build = buildEstimateInputs(bidInput, pricing.admin);
        const r = computeEstimate(build.inputs);
        out.push({
          fileName: file.name,
          conversion,
          payload,
          grandTotal: r.money.grandTotal,
          error: null,
          notes: [...build.warnings, ...pricing.notes],
        });
      } catch (e) {
        out.push({
          fileName: file.name,
          conversion: null,
          payload: null,
          grandTotal: 0,
          error: e instanceof Error ? e.message : "Could not read this file.",
          notes: [],
        });
      }
    }
    setPrepared(out);
    setBusy(null);
  };

  const importable = prepared.filter((p) => p.conversion && p.payload);
  const doImport = async () => {
    if (importable.length === 0) return;
    setBusy("saving");
    try {
      const rows = await importFn({
        data: {
          bids: importable.map((p) => ({
            name: p.conversion!.name,
            data: p.payload as unknown as Record<string, unknown>,
            grandTotal: p.grandTotal,
            status: p.conversion!.status,
            createdAt: p.conversion!.lastSavedAt,
          })),
        },
      });
      void qc.invalidateQueries({ queryKey: ["bids"] });
      toast.success(`Imported ${rows.length} bid${rows.length === 1 ? "" : "s"}.`);
      reset();
      props.onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import old bids (.bax)</DialogTitle>
          <DialogDescription>
            Pick one or more Bid-Advantage .bax files. Each becomes a bid with the labor rate,
            markup, per diem and prices it was saved with; nothing is written until you press
            Import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".bax,application/zip,application/octet-stream"
            multiple
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5"
            disabled={busy !== null}
            onChange={(e) => void prepare(e.target.files)}
          />
          {busy === "reading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading files…
            </p>
          )}
          {prepared.length > 0 && (
            <ul className="divide-y rounded-md border">
              {prepared.map((p) => {
                const c = p.conversion;
                const warnings = [...(c?.warnings ?? []), ...p.notes];
                const open = showWarnings[p.fileName] ?? false;
                return (
                  <li key={p.fileName} className="space-y-1 p-3 text-sm">
                    {p.error ? (
                      <p className="text-destructive">
                        <span className="font-medium">{p.fileName}:</span> {p.error}
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-medium">{c!.name}</p>
                          <p className="font-semibold tabular-nums">{money(p.grandTotal)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {p.fileName} · Bid-Advantage status “{c!.legacyStatus}” →{" "}
                          {STATUS_LABELS[c!.status]}
                          {c!.lastSavedAt
                            ? ` · last saved ${new Date(c!.lastSavedAt).toLocaleDateString()}`
                            : ""}{" "}
                          · labor ${c!.saved.laborRate}/h · markup {c!.saved.markup}%
                          {c!.importInfo.whatIfMarkup !== null
                            ? ` (what-if ${c!.importInfo.whatIfMarkup}%)`
                            : ""}
                        </p>
                        {warnings.length > 0 && (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-amber-700 hover:underline"
                            onClick={() => setShowWarnings((s) => ({ ...s, [p.fileName]: !open }))}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {warnings.length} note{warnings.length === 1 ? "" : "s"} —{" "}
                            {open ? "hide" : "show"}
                          </button>
                        )}
                        {open && (
                          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                            {warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy !== null}>
            Cancel
          </Button>
          <Button
            onClick={() => void doImport()}
            disabled={busy !== null || importable.length === 0}
          >
            {busy === "saving" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 h-4 w-4" />
            )}
            Import {importable.length || ""} bid{importable.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
