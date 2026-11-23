/**
 * The strip on an opportunity that was made from a public page (Nov 23; owner: "i like option
 * A"). A request sent from the Roof Care plans page or the Request service page is an
 * opportunity from the moment it is sent, with no customer on it. This strip shows what the
 * customer typed and lets the office say whose it is.
 *
 * A possible match with an existing customer is only ever offered, never acted on by the site
 * (owner, Nov 18): a person presses "This is …" or "New customer". The customer and the
 * property are made by the functions that already make them (quickCreateAccount, saveSite).
 * A Roof Care request then opens the normal sign-up on the property's page with everything
 * filled in, so every sign-up rule runs and the plan waits for its payment as it does today.
 * When the plan is signed the opportunity is set to Won.
 *
 * Shown to people with Customers access only: the server answers nothing to anyone else.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MapPin, Phone, QrCode, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { canAccess } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { quickCreateAccount, saveSite } from "@/lib/crm.functions";
import { shortDay } from "@/lib/followup-rules";
import {
  CARE_REQUEST_SEARCH,
  customQuoteWhy,
  isCustomQuoteAsk,
  matchWhyWords,
  publicPlanName,
  requestAddress,
  requestStep,
  requestStepWords,
  requestStripTitle,
  type PublicMatch,
  type PublicRequestRow,
} from "@/lib/public-requests";
import { getOpportunityRequest, handlePublicRequest } from "@/lib/public-requests.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const opportunityRequestKey = (opportunityId: string) =>
  ["opportunity-request", opportunityId] as const;

/** What the customer typed on the public page. */
export function RequestFacts({ r }: { r: PublicRequestRow }) {
  const address = requestAddress(r);
  return (
    <div className="space-y-1 text-sm" data-request-facts>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">{r.contact_name}</span>
        {r.company && <span>{r.company}</span>}
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
            page{customQuoteWhy(r) ? `: ${customQuoteWhy(r)}` : ""}.
            {r.plan ? ` They leaned to ${publicPlanName(r.plan)}.` : ""}
            {r.sqft != null
              ? ` Roof size: ${Math.round(r.sqft).toLocaleString("en-US")} sq ft, ${
                  r.sqft_source === "map" ? "from the map" : "as they gave it"
                }.`
              : ""}{" "}
            Nothing was signed and no way of paying was picked.
          </p>
          {r.notes && <p className="whitespace-pre-line">{r.notes}</p>}
        </>
      ) : r.kind === "care" ? (
        <>
          <p>
            <span className="font-medium">{publicPlanName(r.plan)}</span>
            {r.shown_price != null ? `, shown ${money(r.shown_price)} a year` : ""}
            {r.sqft != null
              ? `, for ${Math.round(r.sqft).toLocaleString("en-US")} sq ft, ${
                  r.sqft_source === "map"
                    ? "from the map"
                    : r.sqft_source === "typed"
                      ? "typed by them"
                      : "the middle of the size range they picked"
                }`
              : ""}
            .
          </p>
          <p className="text-muted-foreground">
            Wants to pay by {r.pay_method === "card" ? "card" : "check"}. No payment was taken on
            the page. Agreed to the terms as{" "}
            <span className="font-medium text-foreground">{r.agreed_by}</span>
            {r.terms_version ? `, terms of ${r.terms_version}` : ""}.
            {r.quote?.rough
              ? " The street address was not on the map, so the price is an estimate."
              : ""}
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

export interface RequestCustomer {
  account_id: string;
  site_id: string | null;
  label: string;
}

export function OpportunityRequestStrip({
  opp,
  readOnly,
  onMatched,
}: {
  opp: { id: string; account_id: string | null; site_id: string | null };
  /** A deleted opportunity, or one this person may not change: the facts only. */
  readOnly: boolean;
  /** The customer just put on the opportunity, so the form under the strip shows it at once. */
  onMatched: (c: RequestCustomer) => void;
}) {
  const qc = useQueryClient();
  const { session, profile } = useAuth();
  const may = canAccess(profile, "customers");
  const read = useServerFn(getOpportunityRequest);
  const handle = useServerFn(handlePublicRequest);
  const newAccount = useServerFn(quickCreateAccount);
  const newSite = useServerFn(saveSite);
  const q = useQuery({
    queryKey: opportunityRequestKey(opp.id),
    queryFn: () => read({ data: { opportunity_id: opp.id } }),
    enabled: !!session && may,
    staleTime: 30_000,
    retry: false,
  });
  const r = q.data?.request ?? null;
  const matches = q.data?.matches ?? [];

  /** The customer is known (or just made): the property, then the answer to the request. */
  const finish = async (
    accountId: string,
    siteIdIn: string | null,
    accountName: string,
  ): Promise<RequestCustomer> => {
    if (!r) throw new Error("The request was not read. Reload the page and try again.");
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
    await handle({ data: { id: r.id, status: "matched", account_id: accountId, site_id: siteId } });
    return { account_id: accountId, site_id: siteId, label: accountName };
  };
  const done = (c: RequestCustomer) => {
    onMatched(c);
    void qc.invalidateQueries({ queryKey: opportunityRequestKey(opp.id) });
    void qc.invalidateQueries({ queryKey: ["owner-attention"] });
    toast.success(`${c.label} is on this opportunity now.`);
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
      if (!r) throw new Error("The request was not read. Reload the page and try again.");
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

  if (!may || !r) {
    // Nothing for an opportunity that did not come from a public page. A read that failed is
    // said out loud: the office would otherwise not know a request sits behind it.
    return q.error ? (
      <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        What the customer sent from the public page could not be loaded: {errText(q.error)}
      </p>
    ) : null;
  }
  const busy = existing.isPending || fresh.isPending;
  const step = requestStep(r, opp);
  return (
    <section
      className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-50 p-4 dark:bg-amber-950/20"
      aria-label="Sent from a public page"
      data-request-strip={r.reference}
      data-request-kind={r.kind}
      data-request-step={step}
    >
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 text-base font-semibold">
          <QrCode className="h-4 w-4" /> {requestStripTitle(r)}
        </span>
        <span className="text-xs text-muted-foreground">
          {r.reference} · {shortDay(r.created_at.slice(0, 10))}
        </span>
      </p>
      <RequestFacts r={r} />
      <p className="text-sm font-medium" data-request-next>
        {requestStepWords(step, r)}
      </p>
      {step === "who" && !readOnly && (
        <div className="space-y-2 rounded-lg border bg-background p-3" data-request-matches>
          <p className="text-sm font-medium">
            {matches.length
              ? "This may be a customer we already have. Check before making a new one:"
              : "No customer we have shares their name, phone, email or address."}
          </p>
          {matches.map((m) => (
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
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant={matches.length ? "outline" : "default"}
              size="sm"
              disabled={busy}
              data-action="request-new-customer"
              onClick={() => fresh.mutate()}
            >
              <UserPlus className="mr-1 h-4 w-4" /> New customer
            </Button>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="text-xs text-muted-foreground">
              Not a real request? Delete this opportunity.
            </span>
          </div>
        </div>
      )}
      {step === "sign_up" && !readOnly && opp.site_id && (
        <Button asChild data-action="request-open-sign-up">
          <Link
            to="/properties/$id"
            params={{ id: opp.site_id }}
            search={{ [CARE_REQUEST_SEARCH]: r.id } as never}
          >
            Open the sign-up
          </Link>
        </Button>
      )}
      {step === "signed" && opp.site_id && (
        <Button asChild variant="outline" size="sm" data-action="request-open-plan">
          <Link to="/properties/$id" params={{ id: opp.site_id }}>
            Open the property and its plan
          </Link>
        </Button>
      )}
    </section>
  );
}
