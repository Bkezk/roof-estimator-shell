/**
 * Bid Setup › General Info: the linked customer's contact, in the space beside Estimator, Status
 * and Folder (owner, Nov 13). Whose it is: lib/bid-customer-contact.ts. Read only: the numbers
 * and the email are links (call, write), and "Open customer" is where they are changed.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, Phone, Smartphone } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  accountHasContact,
  bidCustomerContact,
  type ContactAccount,
} from "@/lib/bid-customer-contact";
import { listContacts } from "@/lib/crm.functions";
import { telHref } from "@/lib/maps-link";

export function BidCustomerContact(props: {
  /** The linked customer, or null when the bid is not linked to one. */
  accountId: string | null;
  /** Its card, once read (the estimator already has it). */
  account: ContactAccount | null;
  /** The card is still being read. */
  loading: boolean;
  className?: string;
}) {
  const listFn = useServerFn(listContacts);
  // Only when the card itself has no number and no email. Same key as the Customers page.
  const needContacts = !!props.accountId && !!props.account && !accountHasContact(props.account);
  const contacts = useQuery({
    queryKey: ["contacts", props.accountId],
    queryFn: () => listFn({ data: { account_id: props.accountId! } }),
    enabled: needContacts,
    staleTime: 30_000,
  });
  const card = bidCustomerContact(props.account, contacts.data);
  const waiting = props.loading || (needContacts && contacts.isLoading);

  let body: React.ReactNode;
  if (!props.accountId)
    body = (
      <p className="text-xs text-muted-foreground" data-state="unlinked">
        Pick the customer from the list to see their contact here.
      </p>
    );
  else if (waiting)
    body = (
      <p className="text-xs text-muted-foreground" data-state="loading">
        Loading…
      </p>
    );
  else if (needContacts && contacts.error)
    body = (
      <p className="text-xs text-destructive" data-state="error">
        Could not load the contacts:{" "}
        {contacts.error instanceof Error ? contacts.error.message : String(contacts.error)}
      </p>
    );
  else if (!card)
    body = (
      <p className="text-xs text-muted-foreground" data-state="none">
        No phone or email on file for this customer.
      </p>
    );
  else
    body = (
      <div className="space-y-1 text-sm" data-state="shown" data-source={card.source}>
        {(card.name || card.role) && (
          <p className="break-words">
            {card.name && <span className="font-medium">{card.name}</span>}
            {card.role && (
              <span className="text-muted-foreground">
                {card.name ? " · " : ""}
                {card.role}
              </span>
            )}
          </p>
        )}
        {card.office && (
          <p className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <a href={telHref(card.office)} className="hover:underline" data-line="office">
              {card.office}
            </a>
            <span className="text-xs text-muted-foreground">office</span>
          </p>
        )}
        {card.cell && (
          <p className="flex items-center gap-1.5">
            <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <a href={telHref(card.cell)} className="hover:underline" data-line="cell">
              {card.cell}
            </a>
            <span className="text-xs text-muted-foreground">cell</span>
          </p>
        )}
        {card.email && (
          <p className="flex min-w-0 items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <a
              href={`mailto:${card.email}`}
              className="min-w-0 break-all hover:underline"
              data-line="email"
            >
              {card.email}
            </a>
          </p>
        )}
      </div>
    );

  return (
    <div className={`space-y-1 ${props.className ?? ""}`} data-panel="bid-customer-contact">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="whitespace-nowrap text-xs">{card?.heading ?? "Customer contact"}</Label>
        {props.accountId && (
          <Link
            to="/customers/$id"
            params={{ id: props.accountId }}
            className="whitespace-nowrap text-xs text-muted-foreground hover:underline"
            title="Open this customer (where the contact is changed)"
          >
            Open<span className="sr-only"> customer</span>
          </Link>
        )}
      </div>
      <div className="rounded-md border bg-muted/30 px-2 py-2">{body}</div>
    </div>
  );
}
