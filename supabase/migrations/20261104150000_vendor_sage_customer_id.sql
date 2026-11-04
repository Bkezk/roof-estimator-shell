-- Nov 4 (the Nov 3 review's bug 7; owner: "implement 6 and 7"). An invoice billed to a vendor
-- took its Bill To from the vendor record, which had no Sage customer number, so the Sage CSV's
-- CustomerId column came out blank and the bookkeeper had to look the account up by hand. The
-- vendor record now carries one (typed on the Vendors section, as a customer's "Sage /
-- CenterPoint customer #"); the invoice's Bill To snapshot copies it (vendorBillTo), and the
-- export fills a blank from the vendor's or the customer's current number before it warns.
alter table public.vendors add column if not exists sage_customer_id text;
comment on column public.vendors.sage_customer_id is
  'The vendor''s customer number in Sage, for the CustomerId column of the Sage export when an invoice is billed to the vendor (Nov 4). Blank until the office types it.';
