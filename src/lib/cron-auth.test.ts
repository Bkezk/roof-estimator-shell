import { afterEach, describe, expect, it } from "vitest";

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
  it("answers 500 when nothing is configured (Lovable's own rule)", async () => {
    delete process.env["CRON_SECRET"];
    delete process.env["LOVABLE_CRON_SECRET"];
    expect((await authenticateCron(req("x")))?.status).toBe(500);
  });
});
