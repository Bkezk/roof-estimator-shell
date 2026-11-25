/**
 * Setup › QR pages (Roof Care step 4): the printed sheet with its two QR codes, and the three
 * settings behind the public pages: the services on the request form, the web address the
 * codes hold, and the day's limit of Google lookups.
 *
 * The sheet is the designed leave-behind, front and back (owner, Nov 25, 2026:
 * components/leave-behind-sheet.tsx, lib/leave-behind.ts). The codes are made here, by the site
 * (lib/qr.ts): nothing is fetched from anywhere. The sheet never shows a price (owner, Nov 18).
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
import { LeaveBehind } from "@/components/leave-behind-sheet";
import {
  SHEET_NO_PRICE_NOTE,
  SHEET_PRINT_BUTTON,
  SHEET_PRINT_NOTE,
  sheetServicesLeftOut,
} from "@/lib/leave-behind";
import {
  EMAIL_CAP_NOTE,
  GOOGLE_CAP_NOTE,
  QR_ADDRESS_OWN_SITE,
  QR_ADDRESS_WARNING,
  SERVICES_STARTER_NOTE,
  USAGE_NOTE,
  cleanQrAddress,
  cleanServices,
  emailUsageWords,
  qrAddressIsBorrowed,
  qrSheets,
  usageLine,
  type QrSheet,
} from "@/lib/public-requests";
import {
  getPublicFormSettings,
  savePublicFormSettings,
  type PublicFormSettingsRead,
} from "@/lib/public-requests.functions";
import { qrPixels } from "@/lib/qr";
import { roofCareBenefits } from "@/lib/roof-care-plan.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KEY = ["public-form-settings"] as const;

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

/** Today's date in the office's time, as the counts are filed. */
const todayYmd = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

/** One count beside its limit: amber from four fifths, red at the limit. */
function UsageRow({ name, used, cap }: { name: string; used: number; cap: number }) {
  const u = usageLine(used, cap);
  return (
    <li
      data-usage={name}
      data-usage-level={u.level}
      className={
        u.level === "full"
          ? "font-medium text-destructive"
          : u.level === "near"
            ? "font-medium text-amber-700 dark:text-amber-400"
            : ""
      }
    >
      {name}: <b>{u.words}</b>
      {u.level === "full"
        ? ". The limit is reached: visitors are asked to call until midnight."
        : u.level === "near"
          ? ". Close to the day's limit."
          : ""}
    </li>
  );
}

function Loaded({ s }: { s: PublicFormSettingsRead }) {
  // What each plan includes today, for the printed sheet. Not read: the sheet says it without
  // the numbers, as the public page does.
  const readBenefits = useServerFn(roofCareBenefits);
  const benefits = useQuery({
    queryKey: ["roof-care-benefits"],
    queryFn: () => readBenefits(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const qc = useQueryClient();
  const save = useServerFn(savePublicFormSettings);
  const [services, setServices] = useState<string[]>(s.services);
  const [address, setAddress] = useState(s.qr_base_url ?? "");
  const [cap, setCap] = useState(String(s.google_daily_cap));
  const [emailCap, setEmailCap] = useState(String(s.email_daily_cap));
  useEffect(() => {
    setServices(s.services);
    setAddress(s.qr_base_url ?? "");
    setCap(String(s.google_daily_cap));
    setEmailCap(String(s.email_daily_cap));
  }, [s]);

  const cleanedServices = cleanServices(services);
  const cleanedAddress = cleanQrAddress(address);
  const capNumber = /^\d+$/.test(cap.trim()) ? Number(cap.trim()) : null;
  const capProblem =
    capNumber == null || capNumber > 100_000 ? "Type a whole number from 0 to 100,000." : null;
  const emailCapNumber = /^\d+$/.test(emailCap.trim()) ? Number(emailCap.trim()) : null;
  const emailCapProblem =
    emailCapNumber == null || emailCapNumber > 1_000_000
      ? "Type a whole number from 0 to 1,000,000."
      : null;
  const emailCapChanged = emailCap.trim() !== String(s.email_daily_cap);
  const dirty =
    JSON.stringify(services) !== JSON.stringify(s.services) ||
    address.trim() !== (s.qr_base_url ?? "") ||
    cap.trim() !== String(s.google_daily_cap) ||
    emailCapChanged;
  const problem = !cleanedServices.ok
    ? cleanedServices.problem
    : !cleanedAddress.ok
      ? cleanedAddress.problem
      : (capProblem ?? emailCapProblem);

  const saving = useMutation({
    mutationFn: () =>
      save({
        data: {
          services,
          qr_base_url: address,
          google_daily_cap: capNumber ?? 0,
          ...(emailCapChanged && emailCapNumber != null ? { email_daily_cap: emailCapNumber } : {}),
        },
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
  const servicesLeftOut = sheetServicesLeftOut(s.services);

  return (
    <div className="space-y-6" data-public-forms-setup>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The QR codes</CardTitle>
          <CardDescription>
            One sheet of paper, printed on both sides: the Roof Care plans on the front and the
            additional services on the back, each with its code. {SHEET_NO_PRICE_NOTE}
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
              {/* Owner, Nov 25: the sheet in his flyer's look, both sides, as it will print
                  (components/leave-behind-sheet.tsx). Its plans, services and codes are the
                  saved ones, so the next print is always the current one. */}
              <LeaveBehind
                careUrl={sheets.find((x) => x.key === "care")?.url ?? ""}
                requestUrl={sheets.find((x) => x.key === "request")?.url ?? ""}
                numbers={benefits.data ?? null}
                services={s.services}
              />
              {servicesLeftOut && (
                <p className="text-amber-700 dark:text-amber-300" data-sheet-left-out>
                  {servicesLeftOut}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button data-action="qr-print" onClick={() => window.print()}>
                  <Printer className="mr-1 h-4 w-4" /> {SHEET_PRINT_BUTTON}
                </Button>
                {sheets.map((sheet) => (
                  <Button
                    key={sheet.key}
                    size="sm"
                    variant="outline"
                    data-action="qr-download"
                    data-qr-url={sheet.url}
                    title={`The code by itself, as a picture: ${sheet.url}`}
                    onClick={() => downloadPng(sheet)}
                  >
                    <Download className="mr-1 h-4 w-4" /> {sheet.title} code
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground" data-sheet-print-note>
                {SHEET_PRINT_NOTE}
              </p>
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

      {/* Nov 24 (owner: "Go on 4s suggestions"): today's counts beside their limits. */}
      <Card data-public-usage>
        <CardHeader>
          <CardTitle className="text-base">Today on the public pages</CardTitle>
          <CardDescription>{USAGE_NOTE}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {s.usage ? (
            <>
              <ul className="space-y-1">
                <UsageRow name="Quotes shown" used={s.usage.quote.used} cap={s.usage.quote.cap} />
                <UsageRow
                  name="Requests sent"
                  used={s.usage.request.used}
                  cap={s.usage.request.cap}
                />
                <li data-usage="dropped">
                  Forms dropped as a robot's:{" "}
                  <b>{s.usage.days[0]?.day === todayYmd() ? s.usage.days[0].dropped : 0}</b>
                </li>
              </ul>
              <details>
                <summary className="cursor-pointer text-muted-foreground">The last 30 days</summary>
                {s.usage.days.length === 0 ? (
                  <p className="mt-2 text-muted-foreground">Nothing counted yet.</p>
                ) : (
                  <table className="mt-2 w-full max-w-md text-left" data-usage-days>
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="py-1 font-medium">Day</th>
                        <th className="py-1 text-right font-medium">Quotes shown</th>
                        <th className="py-1 text-right font-medium">Requests</th>
                        <th className="py-1 text-right font-medium">Dropped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.usage.days.map((d) => (
                        <tr key={d.day} className="border-t">
                          <td className="py-1">{d.day}</td>
                          <td className="py-1 text-right">{d.quote.toLocaleString("en-US")}</td>
                          <td className="py-1 text-right">{d.request.toLocaleString("en-US")}</td>
                          <td className="py-1 text-right">{d.dropped.toLocaleString("en-US")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
            </>
          ) : (
            <p className="text-muted-foreground">The counts could not be read just now.</p>
          )}
        </CardContent>
      </Card>

      <Card data-email-usage>
        <CardHeader>
          <CardTitle className="text-base">Emails a day</CardTitle>
          <CardDescription>{EMAIL_CAP_NOTE}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Label htmlFor="email-cap">The most in 24 hours on the email plan</Label>
          <Input
            id="email-cap"
            className="w-32"
            inputMode="numeric"
            value={emailCap}
            disabled={!s.can_edit}
            onChange={(e) => setEmailCap(e.target.value)}
          />
          {emailCapProblem && <p className="text-destructive">{emailCapProblem}</p>}
          {s.usage && (
            <p
              className={
                usageLine(s.usage.email.used, s.usage.email.cap).level === "ok"
                  ? "text-muted-foreground"
                  : "font-medium text-amber-700 dark:text-amber-400"
              }
              data-email-today
            >
              {emailUsageWords(s.usage.email)}
            </p>
          )}
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
