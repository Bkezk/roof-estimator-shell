/**
 * The Customers page as cards and a customer's own page (owner, Oct 14: "each customer take up
 * the length of the screen and have relevant info shown on each card and when you click the card
 * it takes you to the customer profile which has its own page, and get rid of the tickets in
 * progress / overdue tickets / open opps / overdue opps on the customers page"). Fails on the
 * old code: a narrow list beside a detail pane, the counts strip above, no /customers/<id>.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("the list: one full-width card per customer, opening its own page", () => {
  const page = read("src/components/customers-page.tsx");
  const card = page.slice(
    page.indexOf("function AccountCard("),
    page.indexOf("export function CustomerPage("),
  );
  it("the card carries the name and kind, address, contact and reach, manager, properties, tickets in progress", () => {
    expect(page).toContain('<div className="space-y-2" data-list="customers">');
    expect(page).toContain("<AccountCard key={a.id} a={a} managerName=");
    expect(card).toContain('to="/customers/$id"');
    expect(card).toContain("params={{ id: a.id }}");
    expect(card).toContain('{a.kind === "individual" ? "Individual" : "Company"}');
    expect(card).toContain(
      'const address = [a.address1, [a.city, a.state].filter(Boolean).join(", "), a.zip]',
    );
    expect(card).toContain(
      '{a.contact_name && <span className="text-foreground">{a.contact_name}</span>}',
    );
    expect(card).toContain("{a.mobile || a.phone}");
    expect(card).toContain("{a.email}");
    expect(card).toContain('<dt className="text-xs text-muted-foreground">Account manager</dt>');
    expect(card).toContain('<dd>{managerName ?? "Unassigned"}</dd>');
    expect(card).toContain('<dt className="text-xs text-muted-foreground">Properties</dt>');
    expect(card).toContain(
      '<dt className="text-xs text-muted-foreground">Tickets in progress</dt>',
    );
    expect(card).toContain("{!a.deleted_at && !hasContactMethod(a) && <NoContactInfoBadge />}");
  });
  it("the two-pane layout and the counts strip are gone", () => {
    expect(page).not.toContain("md:grid-cols-[minmax(260px,340px)_1fr]");
    expect(page).not.toContain("Pick a customer on the left");
    expect(page).not.toContain("WorkCountsStrip");
    expect(page).not.toContain("activeId");
    expect(existsSync("src/components/work-counts-strip.tsx")).toBe(false);
  });
});

describe("a customer's own page", () => {
  it("/customers/<id> renders CustomerPage; the old ?id= address redirects there", () => {
    const route = read("src/routes/customers_.$id.tsx");
    expect(route).toContain('createFileRoute("/customers_/$id")');
    expect(route).toContain("return <CustomerPage key={id} id={id} />;");
    const list = read("src/routes/customers.tsx");
    expect(list).toContain(
      'if (search.id)\n      throw redirect({ to: "/customers/$id", params: { id: search.id }, replace: true });',
    );
    expect(list).toContain("return <CustomersPage tab={tab} />;");
    // The id search param is still accepted, so every customer link in the app keeps working.
    expect(list).toContain('if (typeof id === "string" && id) out.id = id;');
  });
  it("the page: the title, All customers back to the list, the detail pane full width", () => {
    const page = read("src/components/customers-page.tsx");
    const cp = page.slice(
      page.indexOf("export function CustomerPage("),
      page.indexOf("function AccountList("),
    );
    expect(cp).toContain('<ArrowLeft className="mr-1 h-4 w-4" /> All customers');
    expect(cp).toContain('<Link to="/customers">');
    expect(cp).toContain("<AccountDetailPane id={id} />");
    // A new customer opens on its own page.
    expect(page).toContain(
      'void navigate({ to: "/customers/$id", params: { id: hit.account_id } });',
    );
  });
  it("the gate: /customers/<id> is the Customers page's", async () => {
    const { pageForPath } = await import("@/lib/access");
    expect(pageForPath("/customers/0d1b5a1e-0000-4000-8000-000000000001")).toBe("customers");
  });
});
