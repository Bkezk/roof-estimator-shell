/**
 * "Requests from the public pages" (Roof Care step 4): what visitors sent through the two QR
 * pages, held here until the office says who each one is. A possible match with an existing
 * customer is only ever offered, never acted on by the site (owner, Nov 18): a person presses
 * "This is …" or "New customer".
 *
 * The customer, the property and the opportunity are made by the functions that already make
 * them (quickCreateAccount, saveSite, saveOpportunity). A Roof Care request then opens the
 * normal sign-up on the property's page with everything prefilled, so every sign-up rule runs
 * and the plan waits for its payment as it does today.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, Loader2, Mail, MapPin, Phone, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canAccess } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { quickCreateAccount, saveSite } from "@/lib/crm.functions";
import { shortDay } from "@/lib/followup-rules";
import { saveOpportunity } from "@/lib/opportunities.functions";
import {
  CARE_REQUEST_SEARCH,
  PUBLIC_REQUESTS_PATH,
  callBackDay,
  matchWhyWords,
  opportunityFromRequest,
  publicPlanName,
  publicRequestsButtonWords,
  requestAddress,
  requestAskLine,
  customQuoteWhy,
  isCustomQuoteAsk,
  requestFrom,
  type PublicMatch,
  type PublicRequestRow,
} from "@/lib/public-requests";
import {
  countWaitingPublicRequests,
  handlePublicRequest,
  listPublicRequests,
  type PublicRequestListed,
} from "@/lib/public-requests.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KEY = ["public-requests"] as const;
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * The way to the list from the Opportunities page (Nov 23): a button that always shows for the
 * people who may handle requests (Customers access, as the server and the database ask), with
 * the number waiting on it, coloured when there is one. Anyone else gets no button and no call
 * is made for them, so nobody sees an error for a page that is not theirs.
 */
export function PublicRequestsButton() {
  const { session, profile } = useAuth();
  const may = canAccess(profile, "customers");
  const countFn = useServerFn(countWaitingPublicRequests);
  const q = useQuery({
    queryKey: [...KEY, "waiting"],
    queryFn: () => countFn(),
    enabled: !!session && may,
    staleTime: 60_000,
    retry: false,
  });
  if (!may) return null;
  const waiting = q.data?.waiting ?? 0;
  return (
    <Button
      asChild
      size="lg"
      variant="outline"
      className={`text-base font-semibold ${
        waiting > 0
          ? "border-amber-500 bg-amber-400 text-black hover:bg-amber-400/90 hover:text-black dark:bg-amber-400 dark:text-black"
          : ""
      }`}
    >
      <Link
        to={PUBLIC_REQUESTS_PATH}
        data-action="public-requests"
        data-waiting={waiting}
        title={
          waiting > 0
            ? "Requests sent from the public pages are waiting for someone to say whose they are"
            : "Requests sent from the Roof Care plans page and the Request service page"
        }
      >
        <Inbox className="mr-2 h-5 w-5" /> {publicRequestsButtonWords(waiting)}
      </Link>
    </Button>
  );
}

export function PublicRequestsPage() {
  const list = useServerFn(listPublicRequests);
  const q = useQuery({ queryKey: KEY, queryFn: () => list() });
  if (q.isLoading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the requests…
      </p>
    );
  if (q.error)
    return (
      <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        The requests could not be loaded: {errText(q.error)}
      </p>
    );
  const waiting = q.data?.waiting ?? [];
  const handled = q.data?.handled ?? [];
  return (
    <div className="space-y-6" data-public-requests>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          Waiting for you{" "}
          <span className="font-normal text-muted-foreground">({waiting.length})</span>
        </h2>
        {waiting.length === 0 ? (
          <p
            className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
            data-public-requests-empty
          >
            <Inbox className="h-4 w-4" /> Nothing is waiting. A request sent from a QR page shows
            here.
          </p>
        ) : (
          waiting.map((r) => <RequestCard key={r.id} r={r} />)
        )}
      </section>
      {handled.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Handled lately</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {handled.map((r) => (
              <HandledRow key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Facts({ r }: { r: PublicRequestRow }) {
  const address = requestAddress(r);
  return (
    <div className="space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">{r.contact_name}</span>
        {r.phone && (
          <a className="inline-flex items-center gap-1 underline" href={`tel:${r.phone}`}>
            <Phone className="h-3.5 w-3.5" /> {r.phone}
          </a>
        )}
        {r.email && (
          <a className="inline-flex items-center gap-1 underline" href={`mailto:${r.email}`}>
            <Mail className="h-3.5 w-3.5" /> {r.email}
          </a>
        )}
      </p>
      <p className="flex items-start gap-1">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>
          {r.building_name ? `${r.building_name}, ` : ""}
          {address}
        </span>
      </p>
      {isCustomQuoteAsk(r) ? (
        <>
          <p data-custom-quote>
            <span className="font-medium">Asked for a custom quote.</span> No price was shown on the
            page{customQuoteWhy(r) ? `: ${customQuoteWhy(r)}` : ""}. Call them with a price.
            {r.plan ? ` They leaned to ${publicPlanName(r.plan)}.` : ""}
            {r.sqft != null
              ? ` Roof size: ${Math.round(r.sqft).toLocaleString("en-US")} sq ft (${
                  r.sqft_source === "map" ? "from the map" : "as they gave it"
                }).`
              : ""}{" "}
            Nothing was signed and no way of paying was picked.
          </p>
          {r.notes && <p className="whitespace-pre-line">{r.notes}</p>}
        </>
      ) : r.kind === "care" ? (
        <>
          <p>
            <span className="font-medium">{publicPlanName(r.plan)}</span>
            {r.shown_price != null
              ? `, shown ${money(r.shown_price)} a year`
              : ", no price shown: call them with a quote"}
            {r.sqft != null
              ? `, for ${Math.round(r.sqft).toLocaleString("en-US")} sq ft (${
                  r.sqft_source === "map"
                    ? "from the map"
                    : r.sqft_source === "typed"
                      ? "typed by them"
                      : "the middle of the size range they picked"
                })`
              : ""}
            .
          </p>
          <p className="text-muted-foreground">
            Pays by {r.pay_method === "card" ? "card" : "check"}. Agreed to the terms as{" "}
            <span className="font-medium text-foreground">{r.agreed_by}</span>
            {r.terms_version ? ` (terms of ${r.terms_version})` : ""}.
            {r.quote?.rough
              ? " The street address was not on the map, so the price is an estimate."
              : ""}
            {r.several_buildings ? " They have several buildings: call for pricing." : ""}
          </p>
          {r.notes && <p className="whitespace-pre-line">{r.notes}</p>}
        </>
      ) : (
        <>
          <p>
            <span className="font-medium">Wants:</span> {r.services.join(", ")}
          </p>
          {r.details && <p className="whitespace-pre-line">{r.details}</p>}
        </>
      )}
      {r.referred_by && (
        <p>
          <span className="font-medium">Referred by:</span> {r.referred_by}
        </p>
      )}
    </div>
  );
}

function RequestCard({ r }: { r: PublicRequestListed }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { session } = useAuth();
  const handle = useServerFn(handlePublicRequest);
  const newAccount = useServerFn(quickCreateAccount);
  const newSite = useServerFn(saveSite);
  const newOpp = useServerFn(saveOpportunity);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");

  /** The customer is known (or just made): the property, then what the request becomes. */
  const finish = async (accountId: string, siteIdIn: string | null, accountName: string) => {
    let siteId = siteIdIn;
    if (!siteId) {
      const site = await newSite({
        data: {
          account_id: accountId,
          name: r.building_name.trim() || accountName,
          address1: r.address,
          city: r.city,
          state: r.state,
          zip: r.zip,
        },
      });
      siteId = site.id;
    }
    if (r.kind === "service") {
      const o = opportunityFromRequest(r);
      const opp = await newOpp({
        data: {
          account_id: accountId,
          site_id: siteId,
          title: o.title,
          description: o.description,
          assignee_id: session?.user.id ?? null,
          expected_close: callBackDay(),
          lead_source: "Public request page",
          referred_by: o.referred_by,
        },
      });
      await handle({
        data: {
          id: r.id,
          status: "matched",
          account_id: accountId,
          site_id: siteId,
          opportunity_id: opp.id,
        },
      });
      return { siteId, opportunityId: opp.id as string };
    }
    await handle({ data: { id: r.id, status: "matched", account_id: accountId, site_id: siteId } });
    return { siteId, opportunityId: null };
  };

  const done = (x: { siteId: string; opportunityId: string | null }) => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["owner-attention"] });
    if (isCustomQuoteAsk(r)) {
      toast.success("Matched. Call them with a price: nothing was signed on the page.");
      void nav({ to: "/properties/$id", params: { id: x.siteId } });
    } else if (r.kind === "care") {
      toast.success("Matched. The sign-up opens with what they picked.");
      void nav({
        to: "/properties/$id",
        params: { id: x.siteId },
        search: { [CARE_REQUEST_SEARCH]: r.id } as never,
      });
    } else {
      toast.success("Matched. An opportunity was made, assigned to you, due tomorrow.");
      if (x.opportunityId)
        void nav({ to: "/opportunities", search: { id: x.opportunityId } as never });
    }
  };
  const fail = (e: unknown) =>
    toast.error(`That did not go through: ${errText(e)}`, { duration: 15_000 });

  const existing = useMutation({
    mutationFn: (m: PublicMatch) => finish(m.account_id, m.site_id, m.account_name),
    onSuccess: done,
    onError: fail,
  });
  const fresh = useMutation({
    mutationFn: async () => {
      const company = r.company.trim();
      const hit = await newAccount({
        data: {
          name: company || r.contact_name,
          kind: company ? "company" : "individual",
          contact_name: r.contact_name,
          phone: r.phone,
          email: r.email,
          address1: r.address,
          city: r.city,
          state: r.state,
          zip: r.zip,
          source: "manual",
        },
      });
      return finish(hit.account_id, hit.site_id, hit.account_name);
    },
    onSuccess: done,
    onError: fail,
  });
  const dismiss = useMutation({
    mutationFn: () => handle({ data: { id: r.id, status: "dismissed", reason } }),
    onSuccess: () => {
      toast.success("Dismissed.");
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["owner-attention"] });
    },
    onError: fail,
  });
  const busy = existing.isPending || fresh.isPending || dismiss.isPending;

  return (
    <Card data-public-request={r.reference} data-request-kind={r.kind}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-base">
          <span>{requestFrom(r)}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            {isCustomQuoteAsk(r)
              ? "Custom quote"
              : r.kind === "care"
                ? "Roof Care plan"
                : "Service request"}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {r.reference} · {shortDay(r.created_at.slice(0, 10))}
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{requestAskLine(r)}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Facts r={r} />
        <div className="space-y-2 rounded-lg border p-3" data-request-matches={r.matches.length}>
          <p className="text-sm font-medium">
            {r.matches.length
              ? "This may be a customer we already have. Check before making a new one:"
              : "No customer we have shares their name, phone, email or address."}
          </p>
          {r.matches.map((m) => (
            <div
              key={m.account_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{m.account_name}</p>
                <p className="text-xs text-muted-foreground">
                  {matchWhyWords(m.why)}
                  {m.site_name
                    ? `. Property: ${m.site_name}${m.site_address ? `, ${m.site_address}` : ""}`
                    : ". A new property is added for this address"}
                </p>
              </div>
              <Button
                size="sm"
                disabled={busy}
                data-action="request-match"
                onClick={() => existing.mutate(m)}
              >
                This is {m.account_name}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant={r.matches.length ? "outline" : "default"}
              size="sm"
              disabled={busy}
              data-action="request-new-customer"
              onClick={() => fresh.mutate()}
            >
              <UserPlus className="mr-1 h-4 w-4" /> New customer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              data-action="request-dismiss"
              onClick={() => setDismissing((v) => !v)}
            >
              Dismiss
            </Button>
            {busy && <Loader2 className="h-4 w-4 animate-spin self-center" />}
          </div>
          {dismissing && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor={`why-${r.id}`}>Why it is dismissed</Label>
                <Input
                  id={`why-${r.id}`}
                  value={reason}
                  maxLength={500}
                  placeholder="A test, a wrong number, a duplicate…"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || !reason.trim()}
                data-action="request-dismiss-confirm"
                onClick={() => dismiss.mutate()}
              >
                Dismiss it
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HandledRow({ r }: { r: PublicRequestRow }) {
  const qc = useQueryClient();
  const handle = useServerFn(handlePublicRequest);
  const back = useMutation({
    mutationFn: () => handle({ data: { id: r.id, status: "new" } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errText(e)),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span>
        <span className="font-medium">{requestFrom(r)}</span>{" "}
        <span className="text-muted-foreground">
          · {requestAskLine(r)} · {r.reference}
        </span>
      </span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {r.status === "dismissed"
          ? `Dismissed${r.handled_by_name ? ` by ${r.handled_by_name}` : ""}: ${r.dismiss_reason ?? ""}`
          : `Matched${r.handled_by_name ? ` by ${r.handled_by_name}` : ""}`}
        {r.status === "dismissed" && (
          <Button
            size="sm"
            variant="outline"
            disabled={back.isPending}
            data-action="request-put-back"
            onClick={() => back.mutate()}
          >
            Put back
          </Button>
        )}
      </span>
    </li>
  );
}
