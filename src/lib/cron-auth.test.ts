import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateCron } from "./cron-auth";

const req = (token?: string) =>
  new Request("https://app.test/api/cron/leads", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const saved = { own: process.env["CRON_SECRET"], lov: process.env["LOVABLE_CRON_SECRET"] };
afterEach(() => {
  if (saved.own === undefined) delete process.env["CRON_SECRET"];
  else process.env["CRON_SECRET"] = saved.own;
  if (saved.lov === undefined) delete process.env["LOVABLE_CRON_SECRET"];
  else process.env["LOVABLE_CRON_SECRET"] = saved.lov;
});

describe("authenticateCron", () => {
  it("accepts the owner's CRON_SECRET", async () => {
    process.env["CRON_SECRET"] = "owner-secret-value";
    delete process.env["LOVABLE_CRON_SECRET"];
    expect(await authenticateCron(req("owner-secret-value"))).toBeNull();
  });
  it("refuses a wrong or missing token with 401 when only the owner's secret is set", async () => {
    process.env["CRON_SECRET"] = "owner-secret-value";
    delete process.env["LOVABLE_CRON_SECRET"];
    expect((await authenticateCron(req("nope")))?.status).toBe(401);
    expect((await authenticateCron(req()))?.status).toBe(401);
  });
  it("still accepts Lovable's secret when both are set", async () => {
    process.env["CRON_SECRET"] = "owner-secret-value";
    process.env["LOVABLE_CRON_SECRET"] = "lovable-value";
    expect(await authenticateCron(req("lovable-value"))).toBeNull();
    expect(await authenticateCron(req("owner-secret-value"))).toBeNull();
    expect((await authenticateCron(req("other")))?.status).toBe(401);
  });
  // Nov 24 (public pages audit): this was a 500 ("Server configuration error", Lovable's own
  // rule), a different answer from a wrong secret's. Now it is the same plain 401, and the
  // reason goes to the server log (secret-doors-nov24.test.ts).
  it("answers the same 401 when nothing is configured, and says why in the server log", async () => {
    delete process.env["CRON_SECRET"];
    delete process.env["LOVABLE_CRON_SECRET"];
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "));
    });
    const res = await authenticateCron(req("x"));
    spy.mockRestore();
    expect(res?.status).toBe(401);
    expect(await res?.text()).toBe("Unauthorized");
    expect(logged.join("\n")).toContain("No usable CRON_SECRET or LOVABLE_CRON_SECRET is set");
  });
});
