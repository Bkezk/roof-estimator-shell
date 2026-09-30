/**
 * Two small pieces of the editor's header, kept out of editor.tsx so it stays easy to merge:
 *  - TakeoffCustomerChip: the customer the takeoff (its building plans) belongs to, linking to
 *    the profile. On open, a takeoff with no customer whose bid has one inherits the bid's
 *    (owner, Sep 30), with a toast saying so.
 *  - ExportMarkupButton: "Export marked-up PDF" (src/lib/takeoff/markup-pdf.ts).
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileDown, Link2, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  setTakeoffAccount,
  type LinkedAccount,
  type TakeoffWithBid,
} from "@/lib/takeoff.functions";
import { takeoffAccountFromBid } from "@/lib/takeoff/create-bid";
import {
  buildMarkupPdf,
  canvasToJpeg,
  downloadPdf,
  markupFileName,
} from "@/lib/takeoff/markup-pdf";
import type { TakeoffObject, TakeoffPage } from "@/lib/takeoff/model";
import { Button } from "@/components/ui/button";

import { Tip } from "./toolbar";
import { renderUnderlayPage, type UnderlaySource } from "./underlay";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function TakeoffCustomerChip(props: {
  row: TakeoffWithBid;
  customer: LinkedAccount | null;
  onChange: (next: LinkedAccount | null) => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const setFn = useServerFn(setTakeoffAccount);
  const { row, onChange } = props;
  // Once per opened takeoff: inherit the linked bid's customer when this takeoff has none.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const inherit = takeoffAccountFromBid(row.account_id, row.bid?.account_id);
    if (!inherit || !can("takeoff")) return;
    setFn({ data: { id: row.id, account_id: inherit } })
      .then((r) => {
        onChange(r.account ?? { id: inherit, name: "" });
        toast.info(
          `Takeoff linked to ${r.account?.name ? `“${r.account.name}”` : "the customer"}, the customer of bid “${row.bid?.name ?? ""}”.`,
        );
        void qc.invalidateQueries({ queryKey: ["takeoffs"] });
        void qc.invalidateQueries({ queryKey: ["account-takeoffs"] });
      })
      .catch((e: unknown) =>
        toast.error(`Could not link the takeoff to the bid's customer: ${errText(e)}`),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened takeoff
  }, []);

  const c = props.customer;
  if (!c) return null;
  const label = c.name || "Customer";
  return (
    <span
      className="inline-flex max-w-[220px] items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      title="The customer these plans belong to (change it on the Setup tab)"
    >
      <Link2 className="h-3 w-3 shrink-0" />
      {can("customers") ? (
        <Link
          to="/customers"
          search={{ id: c.id }}
          target="_blank"
          className="truncate font-medium text-foreground underline-offset-2 hover:underline"
        >
          {label}
        </Link>
      ) : (
        <span className="truncate font-medium text-foreground">{label}</span>
      )}
    </span>
  );
}

export function ExportMarkupButton(props: {
  name: string;
  customer: LinkedAccount | null;
  pages: readonly TakeoffPage[];
  objects: readonly TakeoffObject[];
  source: UnderlaySource | null;
}) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const source = props.source;
    if (!source) {
      toast.error("The plan file has not loaded yet; try again in a moment.");
      return;
    }
    setBusy(true);
    try {
      const takeoffName = props.name.trim() || "Untitled takeoff";
      const { bytes, sheetCount } = await buildMarkupPdf({
        takeoffName,
        customer: props.customer?.name || null,
        exportedBy: (profile?.full_name ?? "").trim() || profile?.email || null,
        exportedAt: new Date().toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
        pages: props.pages,
        objects: props.objects,
        render: (p, scale) => renderUnderlayPage(source, p.index, p.rotation, scale).promise,
        encode: (canvas) => canvasToJpeg(canvas),
      });
      const fileName = markupFileName(takeoffName);
      downloadPdf(fileName, bytes);
      toast.success(
        `Exported “${fileName}”: ${sheetCount} marked-up sheet${sheetCount === 1 ? "" : "s"} and the summary.`,
      );
    } catch (e) {
      toast.error(`Could not export the marked-up PDF: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const nothing = props.objects.length === 0;
  const disabled = busy || nothing || !props.source;
  return (
    <Tip
      name="Export marked-up PDF"
      wrap={disabled}
      text={
        nothing
          ? "draw something first"
          : "every page with objects, marked up and labelled, plus a quantities summary"
      }
    >
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={(e) => {
          void run();
          if (e.detail > 0) e.currentTarget.blur();
        }}
      >
        {busy ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="mr-1 h-4 w-4" />
        )}
        Export marked-up PDF
      </Button>
    </Tip>
  );
}
