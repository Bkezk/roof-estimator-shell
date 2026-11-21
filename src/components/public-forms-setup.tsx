/**
 * Setup › QR pages (Roof Care step 4): the two QR codes for the printed sheets, and the three
 * settings behind the public pages: the services on the request form, the web address the
 * codes hold, and the day's limit of Google lookups.
 *
 * The codes are made here, by the site (lib/qr.ts): nothing is fetched from anywhere. A sheet
 * never shows a price (owner, Nov 18).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Download, Loader2, Plus, Printer, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GOOGLE_CAP_NOTE,
  QR_ADDRESS_OWN_SITE,
  QR_ADDRESS_WARNING,
  SERVICES_STARTER_NOTE,
  cleanQrAddress,
  cleanServices,
  qrAddressIsBorrowed,
  qrSheets,
  type QrSheet,
} from "@/lib/public-requests";
import {
  getPublicFormSettings,
  savePublicFormSettings,
  type PublicFormSettingsRead,
} from "@/lib/public-requests.functions";
import { qrPixels, qrSvg } from "@/lib/qr";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KEY = ["public-form-settings"] as const;

/** Only the sheets print: the rest of the page, and the menu, stay off the paper. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  [data-qr-print], [data-qr-print] * { visibility: visible !important; }
  [data-qr-print] { position: absolute; left: 0; top: 0; width: 100%; }
  [data-qr-sheet] { break-after: page; page-break-after: always; height: 100vh; display: flex;
    flex-direction: column; align-items: center; justify-content: center; text-align: center;
    border: 0 !important; }
  [data-qr-sheet]:last-child { break-after: auto; page-break-after: auto; }
  [data-qr-sheet] [data-qr-code] { width: 5in !important; height: 5in !important; }
  [data-qr-no-print] { display: none !important; }
}`;

/** The code as a picture file, drawn here: 24 pixels to a cell is sharp at any printed size. */
function downloadPng(sheet: QrSheet) {
  const px = qrPixels(sheet.url, 24);
  const canvas = document.createElement("canvas");
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    toast.error("This browser could not draw the picture. Print the sheet instead.");
    return;
  }
  const image = ctx.createImageData(px.width, px.height);
  image.data.set(px.data);
  ctx.putImageData(image, 0, 0);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = sheet.file;
  a.click();
}

export function PublicFormsSetup() {
  const read = useServerFn(getPublicFormSettings);
  const q = useQuery({ queryKey: KEY, queryFn: () => read() });
  if (q.isLoading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  if (q.error || !q.data)
    return (
      <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        The QR page settings could not be loaded: {errText(q.error)}
      </p>
    );
  return <Loaded s={q.data} />;
}

function Loaded({ s }: { s: PublicFormSettingsRead }) {
  const qc = useQueryClient();
  const save = useServerFn(savePublicFormSettings);
  const [services, setServices] = useState<string[]>(s.services);
  const [address, setAddress] = useState(s.qr_base_url ?? "");
  const [cap, setCap] = useState(String(s.google_daily_cap));
  useEffect(() => {
    setServices(s.services);
    setAddress(s.qr_base_url ?? "");
    setCap(String(s.google_daily_cap));
  }, [s]);

  const cleanedServices = cleanServices(services);
  const cleanedAddress = cleanQrAddress(address);
  const capNumber = /^\d+$/.test(cap.trim()) ? Number(cap.trim()) : null;
  const capProblem =
    capNumber == null || capNumber > 100_000 ? "Type a whole number from 0 to 100,000." : null;
  const dirty =
    JSON.stringify(services) !== JSON.stringify(s.services) ||
    address.trim() !== (s.qr_base_url ?? "") ||
    cap.trim() !== String(s.google_daily_cap);
  const problem = !cleanedServices.ok
    ? cleanedServices.problem
    : !cleanedAddress.ok
      ? cleanedAddress.problem
      : capProblem;

  const saving = useMutation({
    mutationFn: () =>
      save({
        data: { services, qr_base_url: address, google_daily_cap: capNumber ?? 0 },
      }),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      toast.success("Saved.");
    },
    onError: (e) => toast.error(`Not saved: ${errText(e)}`, { duration: 15_000 }),
  });

  // The codes show the saved address, so what is printed is what was saved.
  const base = s.qr_base_url ?? s.own_url;
  const sheets = useMemo(() => (base ? qrSheets(base) : []), [base]);
  const borrowed = !s.qr_base_url || qrAddressIsBorrowed(base);

  return (
    <div className="space-y-6" data-public-forms-setup>
      <style>{PRINT_CSS}</style>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The QR codes</CardTitle>
          <CardDescription>
            One sheet for each public page. No prices are printed: the price shows on the
            customer&apos;s phone once they type their address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {borrowed && (
            <p
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
              data-qr-warning
            >
              {s.qr_base_url ? QR_ADDRESS_WARNING : `${QR_ADDRESS_OWN_SITE} ${QR_ADDRESS_WARNING}`}
            </p>
          )}
          {dirty && (
            <p className="text-muted-foreground" data-qr-unsaved>
              The codes below are for the saved address. Save to see them for the new one.
            </p>
          )}
          {sheets.length === 0 ? (
            <p className="text-destructive">
              The site&apos;s own address is not known here. Type the address the codes should hold
              below and save.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2" data-qr-print>
                {sheets.map((sheet) => (
                  <div
                    key={sheet.key}
                    className="space-y-2 rounded-xl border p-4 text-center"
                    data-qr-sheet={sheet.key}
                  >
                    <p className="text-xl font-bold tracking-tight">{sheet.title}</p>
                    <div
                      className="mx-auto h-56 w-56"
                      data-qr-code
                      data-qr-url={sheet.url}
                      // The picture is made here from the address alone: lib/qr.ts qrSvg.
                      dangerouslySetInnerHTML={{ __html: qrSvg(sheet.url, sheet.title) }}
                    />
                    <p>{sheet.line}</p>
                    <p className="break-all text-xs text-muted-foreground">{sheet.url}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      data-qr-no-print
                      data-action="qr-download"
                      onClick={() => downloadPng(sheet)}
                    >
                      <Download className="mr-1 h-4 w-4" /> Download as picture
                    </Button>
                  </div>
                ))}
              </div>
              <Button data-action="qr-print" onClick={() => window.print()}>
                <Printer className="mr-1 h-4 w-4" /> Print the two sheets
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The web address printed in the QR codes</CardTitle>
          <CardDescription>{QR_ADDRESS_WARNING}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Label htmlFor="qr-address">Address</Label>
          <Input
            id="qr-address"
            className="max-w-md"
            value={address}
            disabled={!s.can_edit}
            placeholder={s.own_url || "portal.example.com"}
            autoCapitalize="none"
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="text-muted-foreground">
            Leave it blank to use this site&apos;s own address
            {s.own_url ? ` (${s.own_url})` : ""}.
          </p>
          {!cleanedAddress.ok && <p className="text-destructive">{cleanedAddress.problem}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Services on the Request service page</CardTitle>
          <CardDescription>
            The tick boxes a customer picks from, in this order. {SERVICES_STARTER_NOTE}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {services.map((name, i) => (
            <div key={i} className="flex items-center gap-2" data-service-row={i}>
              <Input
                aria-label={`Service ${i + 1}`}
                className="max-w-md"
                value={name}
                maxLength={120}
                disabled={!s.can_edit}
                onChange={(e) =>
                  setServices(services.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              {s.can_edit && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...services];
                      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                      setServices(next);
                    }}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={i === services.length - 1}
                    onClick={() => {
                      const next = [...services];
                      [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                      setServices(next);
                    }}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${name || "this service"}`}
                    onClick={() => setServices(services.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
          {s.can_edit && (
            <Button
              size="sm"
              variant="outline"
              data-action="service-add"
              onClick={() => setServices([...services, ""])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add a service
            </Button>
          )}
          {!cleanedServices.ok && <p className="text-destructive">{cleanedServices.problem}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google drive lookups a day</CardTitle>
          <CardDescription>{GOOGLE_CAP_NOTE}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Label htmlFor="google-cap">The most in one day</Label>
          <Input
            id="google-cap"
            className="w-32"
            inputMode="numeric"
            value={cap}
            disabled={!s.can_edit}
            onChange={(e) => setCap(e.target.value)}
          />
          {capProblem && <p className="text-destructive">{capProblem}</p>}
          <p className="text-muted-foreground" data-google-today>
            Today: {s.google.used} of {s.google.cap} asked of Google
            {s.google.held > 0
              ? `, and ${s.google.held} answered by the free router because the limit was reached.`
              : "."}
          </p>
        </CardContent>
      </Card>

      {s.can_edit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!dirty || !!problem || saving.isPending}
            data-action="public-forms-save"
            onClick={() => saving.mutate()}
          >
            {saving.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save
          </Button>
          {s.updated_by_name && (
            <span className="text-xs text-muted-foreground">Last saved by {s.updated_by_name}</span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          An admin or a manager changes these settings.
        </p>
      )}
    </div>
  );
}
