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
 * The opportunity is set to Won the day that payment is received (the database does it).
 *
 * Shown to people with Customers access only: the server answers nothing to anyone else.
 *
 * Nov 26 (the audit of Nov 25, numbers 15 and 17):
 *  - One answer. The notice of a request goes to every admin and manager at once. Before this
 *    page makes a customer or a property it takes the request for this person in the database
 *    (claimPublicRequest). The second person is told somebody has it, and has made nothing.
 *  - The same building. A possible match is offered as generously as before, but the plan
 *    starts by itself only at a property whose address is the one they typed. At an address
 *    that is only alike, both addresses are shown and the plan starts on one more press.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MapPin, Phone, QrCode, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { RoofCareCard } from "@/components/roof-care/plan-card";
import { Button } from "@/components/ui/button";
import { canAccess } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { quickCreateAccount, saveSite } from "@/lib/crm.functions";
import { shortDay } from "@/lib/followup-rules";
import {
  CARE_ADDRESS_DIFFERS,
  CARE_MATCH_ADDRESS_DIFFERS,
  CARE_OPEN_SIGN_UP,
  CARE_REQUEST_SEARCH,
  CARE_SIGNED_NOT_READ,
  CARE_START_AT_MATCH,
  CARE_START_BUTTON,
  CARE_START_HERE_BUTTON,
  CARE_START_OTHER_ADDRESS,
  CARE_STARTED_WORDS,
  carePrefill,
  careShownWords,
  careStartsItself,
  customQuoteWhy,
  emailLink,
  isCustomQuoteAsk,
  matchWhyWords,
  phoneLink,
  publicPlanName,
  requestAddress,
  requestStep,
  requestStepWords,
  requestStripTitle,
  type PublicMatch,
  type PublicRequestRow,
} from "@/lib/public-requests";
import {
  claimPublicRequest,
  getOpportunityRequest,
  handlePublicRequest,
} from "@/lib/public-requests.functions";
import { ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";
import { startPlanFromRequest } from "@/lib/roof-care-plan.functions";

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
        {/* Nov 24: a link is made only from a plain number or a plain address (phoneLink,
            emailLink). Anything else a visitor typed shows as text, with no link behind it. */}
        {r.phone &&
          (phoneLink(r.phone) ? (
            <a
              className="inline-flex items-center gap-1 underline"
              href={phoneLink(r.phone)!}
              data-request-phone
            >
              <Phone className="h-3.5 w-3.5" /> {r.phone}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1" data-request-phone>
              <Phone className="h-3.5 w-3.5" /> {r.phone}
            </span>
          ))}
        {r.email &&
          (emailLink(r.email) ? (
            <a
              className="inline-flex items-center gap-1 underline"
              href={emailLink(r.email)!}
              data-request-email
            >
              <Mail className="h-3.5 w-3.5" /> {r.email}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1" data-request-email>
              <Mail className="h-3.5 w-3.5" /> {r.email}
            </span>
          ))}
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
            <span data-request-shown>{careShownWords(r)}</span>
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
  /**
   * Nov 26: is the property the building they typed? True for a property this page just made
   * from the request's own address. Only then does the plan start by itself.
   */
  same_address?: boolean;
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
  const claim = useServerFn(claimPublicRequest);
  const newAccount = useServerFn(quickCreateAccount);
  const newSite = useServerFn(saveSite);
  const q = useQuery({
    // Nov 26: read again whenever the customer or the property on the opportunity changes (a
    // save of the form, an answer given here), so the box never shows the request as it was.
    // What was read before stays on the screen until the new read is in: of this opportunity
    // only, never another one's request.
    queryKey: [...opportunityRequestKey(opp.id), opp.account_id, opp.site_id],
    queryFn: () => read({ data: { opportunity_id: opp.id } }),
    enabled: !!session && may,
    staleTime: 30_000,
    retry: false,
    placeholderData: (before, was) => (was?.queryKey[1] === opp.id ? before : undefined),
  });
  const r = q.data?.request ?? null;
  const matches = q.data?.matches ?? [];
  // Nov 24 (owner: the sign-up window "pops up ... again, it should just ask us to confirm the
  // roof size, then send the payment link"). When the customer typed a roof size and ticked
  // the terms in use, the plan is started from what they sent, with no window. `startWhy`: why
  // a try did not go, said beside the button that opens the window.
  const auto = careStartsItself(r ? carePrefill(r) : null, ROOF_CARE_TERMS_VERSION);
  const startFn = useServerFn(startPlanFromRequest);
  const [startWhy, setStartWhy] = useState<string | null>(null);
  const [addressAsked, setAddressAsked] = useState(false);
  const start = useMutation({
    // `addressOk`: the office looked at both addresses and pressed "Start the plan at this
    // property". Without it the server starts a plan only at the building they typed.
    mutationFn: (at: { siteId: string; addressOk?: boolean }) => {
      if (!r) throw new Error("The request was not read. Reload the page and try again.");
      return startFn({
        data: {
          request_id: r.id,
          site_id: at.siteId,
          ...(at.addressOk ? { address_ok: true } : {}),
        },
      });
    },
    onSuccess: (made) => {
      setStartWhy(null);
      void qc.invalidateQueries({ queryKey: opportunityRequestKey(opp.id) });
      void qc.invalidateQueries({ queryKey: ["roof-care-plans"] });
      void qc.invalidateQueries({ queryKey: ["owner-attention"] });
      // Nov 26: signed, and the page could not read it back. Said as that, never as a failure.
      if (made.unread) toast.warning(CARE_SIGNED_NOT_READ, { duration: 30_000 });
      else if (made.tied) toast.success(CARE_STARTED_WORDS, { duration: 20_000 });
      else
        toast.warning(
          "The plan is made, but this request could not be tied to it. When the plan is paid, set this opportunity to Won.",
          { duration: 30_000 },
        );
    },
    onError: (e) => {
      // The server found another address than the one they typed: the box shows both, and its
      // button starts the plan there. Any other reason is said beside the sign-up button.
      if (errText(e).includes(CARE_START_OTHER_ADDRESS)) setAddressAsked(true);
      else setStartWhy(errText(e));
      // What somebody else did in the meantime is read, so the box shows where it stands.
      void qc.invalidateQueries({ queryKey: opportunityRequestKey(opp.id) });
      void qc.invalidateQueries({ queryKey: ["roof-care-plans"] });
      toast.error(`The plan was not started: ${errText(e)}`, { duration: 20_000 });
    },
  });

  // A customer this page made for this request and could not yet put on it: a second press by
  // the same person uses it, and does not make another.
  const madeHere = useRef<{
    request: string;
    hit: Awaited<ReturnType<typeof newAccount>>;
  } | null>(null);

  /**
   * Nov 26: "I am answering this request", said to the database before anything is made. It
   * refuses when somebody already answered, or is answering right now, and this page then
   * makes no customer and no property.
   */
  const takeIt = async () => {
    if (!r) throw new Error("The request was not read. Reload the page and try again.");
    await claim({ data: { id: r.id } });
  };

  /** The customer is known (or just made): the property, then the answer to the request. */
  const finish = async (
    accountId: string,
    siteIdIn: string | null,
    accountName: string,
    sameAddress = true,
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
    return {
      account_id: accountId,
      site_id: siteId,
      label: accountName,
      // A property made just now holds the address they typed.
      same_address: siteIdIn ? sameAddress : true,
    };
  };
  const done = (c: RequestCustomer) => {
    onMatched(c);
    void qc.invalidateQueries({ queryKey: opportunityRequestKey(opp.id) });
    void qc.invalidateQueries({ queryKey: ["owner-attention"] });
    toast.success(`${c.label} is on this opportunity now.`);
    // Whose it is was the only thing the office had to say: the plan they picked is started.
    // Nov 26: only at the building they typed. At an address that is only alike, the box now
    // shows both and its button starts the plan.
    if (c.site_id && auto.ok && c.same_address) start.mutate({ siteId: c.site_id });
  };
  const fail = (e: unknown) => {
    // Somebody else may have answered it: the request is read again, so the box shows it.
    void qc.invalidateQueries({ queryKey: opportunityRequestKey(opp.id) });
    toast.error(`That did not go through: ${errText(e)}`, { duration: 15_000 });
  };
  const existing = useMutation({
    mutationFn: async (m: PublicMatch) => {
      await takeIt();
      return finish(m.account_id, m.site_id, m.account_name, m.same_address);
    },
    onSuccess: done,
    onError: fail,
  });
  const fresh = useMutation({
    mutationFn: async () => {
      if (!r) throw new Error("The request was not read. Reload the page and try again.");
      // The request is taken first: the one who loses makes no customer.
      await takeIt();
      const company = r.company.trim();
      const kept = madeHere.current?.request === r.id ? madeHere.current.hit : null;
      const hit =
        kept ??
        (await newAccount({
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
        }));
      madeHere.current = { request: r.id, hit };
      const c = await finish(hit.account_id, hit.site_id, hit.account_name);
      madeHere.current = null;
      return c;
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
  const step = requestStep(r, opp, q.data?.plan_status);
  // Nov 26: the property this opportunity is on, beside the address they typed. Until the
  // server has said the two are the same building, the plan does not start on one press.
  const site = q.data?.site && q.data.site.id === opp.site_id ? q.data.site : null;
  // Known to be another address (the read says so), or the server just refused for it.
  const sameAddress = !((site && !site.same_address) || addressAsked);
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
        {requestStepWords(step, r, {
          ended_on: q.data?.plan_ended_on,
          paid: q.data?.plan_paid,
        })}
      </p>
      {step === "who" && !readOnly && auto.ok && (
        <p className="text-sm text-muted-foreground" data-request-start-at-match>
          {CARE_START_AT_MATCH}
        </p>
      )}
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
                {/* Nov 26: a property that is only alike never starts the plan by itself. */}
                {auto.ok && m.site_id && !m.same_address && (
                  <p
                    className="text-xs font-medium text-amber-800 dark:text-amber-300"
                    data-request-match-differs
                  >
                    {CARE_MATCH_ADDRESS_DIFFERS}
                  </p>
                )}
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
        <div className="space-y-2" data-request-start={auto.ok && !startWhy ? "itself" : "window"}>
          {!auto.ok || startWhy ? (
            <p className="text-sm text-muted-foreground" data-request-start-why>
              {startWhy ?? (auto.ok ? "" : auto.why)}
            </p>
          ) : null}
          {/* Nov 26: the property is not the address they typed. Both are shown, and the plan
              starts here only on this press. */}
          {auto.ok && !startWhy && !sameAddress && (
            <div
              className="space-y-2 rounded-lg border border-amber-500/60 bg-background p-3 text-sm"
              data-request-addresses
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  <span className="block text-xs text-muted-foreground">They typed</span>
                  <span className="font-medium">{requestAddress(r)}</span>
                </p>
                <p>
                  <span className="block text-xs text-muted-foreground">
                    The property on this opportunity
                  </span>
                  <span className="font-medium">
                    {site
                      ? [site.name, site.address].filter(Boolean).join(": ")
                      : "Open the property to see its address."}
                  </span>
                </p>
              </div>
              <p className="text-amber-800 dark:text-amber-300">{CARE_ADDRESS_DIFFERS}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {auto.ok && !startWhy && (
              <Button
                disabled={start.isPending}
                onClick={() => start.mutate({ siteId: opp.site_id!, addressOk: !sameAddress })}
                data-action={sameAddress ? "request-start-plan" : "request-start-plan-here"}
              >
                {start.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {sameAddress ? CARE_START_BUTTON : CARE_START_HERE_BUTTON}
              </Button>
            )}
            {/* The window is still there: to change what they picked, or when the plan cannot
                be started by itself. */}
            <Button
              asChild
              variant={auto.ok && !startWhy ? "ghost" : "default"}
              size={auto.ok && !startWhy ? "sm" : "default"}
              data-action="request-open-sign-up"
            >
              <Link
                to="/properties/$id"
                params={{ id: opp.site_id }}
                search={{ [CARE_REQUEST_SEARCH]: r.id } as never}
              >
                {auto.ok && !startWhy ? "Change something first" : CARE_OPEN_SIGN_UP}
              </Link>
            </Button>
          </div>
        </div>
      )}
      {/* The plan's own steps, here (Nov 24): confirm the roof size, send the payment link.
          The page looks for the payment by itself and this opportunity then shows Won. */}
      {step === "signed" && opp.site_id && (
        <RoofCareCard siteId={opp.site_id} brief className="bg-background" />
      )}
      {(step === "signed" || step === "paid" || step === "ended") && opp.site_id && (
        <Button asChild variant="outline" size="sm" data-action="request-open-plan">
          <Link to="/properties/$id" params={{ id: opp.site_id }}>
            Open the property and its plan
          </Link>
        </Button>
      )}
    </section>
  );
}
