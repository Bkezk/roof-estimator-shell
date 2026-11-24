/**
 * "Card payment link" on a plan that waits for a card payment (owner, Nov 23: "1. A go"). The
 * customer is not always at the screen: one who signed up through the QR page is at home. This
 * gives the office that plan's own link, to copy into a text or to email to the customer on
 * the plan. The customer opens it and pays by card; the payment starts the plan.
 *
 * Nothing is sent by itself from here: a person presses Copy or Email. Since Nov 24 it is the
 * only way the link reaches a customer: the agreement email no longer holds it, so the office
 * sends the payment request after it is sure of the roof size.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Link2, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { longDay } from "@/lib/followup-rules";
import {
  PAY_LINK_BUTTON,
  PAY_LINK_COPIED,
  PAY_LINK_COPY,
  PAY_LINK_NOT_SENT,
  PAY_LINK_NOTE,
  payLinkSentWords,
} from "@/lib/roof-care-pay-link";
import { emailPlanPayLink, planPayLink } from "@/lib/roof-care-pay-link.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PlanPayLinkBox({ planId }: { planId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const read = useServerFn(planPayLink);
  const send = useServerFn(emailPlanPayLink);
  const key = ["roof-care-pay-link", planId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => read({ data: { plan_id: planId } }),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const email = useMutation({
    mutationFn: () => send({ data: { plan_id: planId } }),
    onSuccess: (r) => {
      toast.success(`The card payment link was emailed to ${r.to}.`);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errText(e), { duration: 20_000 }),
  });
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(PAY_LINK_COPIED);
    } catch {
      toast.error("The link could not be copied here. Select it in the box and copy it by hand.", {
        duration: 15_000,
      });
    }
  };
  const l = q.data;
  return (
    <div className="space-y-1.5" data-roof-care-pay-link={open ? "open" : "closed"}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-action="roof-care-pay-link"
      >
        <Link2 className="mr-1 h-3.5 w-3.5" /> {PAY_LINK_BUTTON}
      </Button>
      {open && (
        <div className="space-y-1.5 rounded-md border p-2">
          {q.isLoading && (
            <p className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the link…
            </p>
          )}
          {q.error && <p className="text-destructive">{errText(q.error)}</p>}
          {l && !l.url && (
            <p className="font-medium" data-pay-link-held>
              {l.reason}
            </p>
          )}
          {l?.url && (
            <>
              <p className="text-muted-foreground">{PAY_LINK_NOTE}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  readOnly
                  aria-label="The customer's card payment link"
                  className="h-8 min-w-0 flex-1 text-xs"
                  value={l.url}
                  onFocus={(e) => e.currentTarget.select()}
                  data-pay-link-url
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void copy(l.url!)}
                  data-action="roof-care-pay-link-copy"
                >
                  <Copy className="mr-1 h-3.5 w-3.5" /> {PAY_LINK_COPY}
                </Button>
              </div>
              {l.email_reason ? (
                <p className="text-muted-foreground" data-pay-link-no-email>
                  Emailing it from here: {l.email_reason}
                </p>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={email.isPending}
                  onClick={() => email.mutate()}
                  data-action="roof-care-pay-link-email"
                >
                  {email.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mail className="mr-1 h-3.5 w-3.5" />
                  )}
                  Email it to {l.to}
                </Button>
              )}
              {payLinkSentWords(l, longDay) ? (
                <p className="text-muted-foreground" data-pay-link-sent>
                  {payLinkSentWords(l, longDay)}
                </p>
              ) : (
                <p className="font-medium text-amber-800 dark:text-amber-300" data-pay-link-unsent>
                  {PAY_LINK_NOT_SENT}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
