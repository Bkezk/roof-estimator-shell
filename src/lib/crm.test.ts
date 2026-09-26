import { describe, expect, it } from "vitest";

import { siteAddressLine } from "@/lib/crm.functions";

describe("siteAddressLine", () => {
  it("joins street, city and state/zip, skipping blanks", () => {
    expect(
      siteAddressLine({
        address1: "4840 West Cumberland Avenue",
        address2: null,
        city: "Middlesboro",
        state: "KY",
        zip: "40965",
      }),
    ).toBe("4840 West Cumberland Avenue, Middlesboro, KY 40965");
    expect(
      siteAddressLine({ address1: "PO Box 340", address2: "", city: "", state: "KY", zip: null }),
    ).toBe("PO Box 340, KY");
    expect(
      siteAddressLine({ address1: null, address2: null, city: null, state: null, zip: null }),
    ).toBe("");
    expect(siteAddressLine(null)).toBe("");
  });
});
