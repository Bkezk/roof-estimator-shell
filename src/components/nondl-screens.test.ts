import { describe, expect, it } from "vitest";

import { customBoxAdds } from "./nondl-custom-box";

describe("Non-DL custom item box: Enter or Tab adds the item and lands in Quantity (owner, Oct 27)", () => {
  it("Enter adds, typed or not", () => {
    expect(customBoxAdds("Enter", false, "Pavers")).toBe(true);
    expect(customBoxAdds("Enter", false, "")).toBe(true);
  });
  it("Tab adds when something is typed (the old code let Tab leave the box)", () => {
    expect(customBoxAdds("Tab", false, "Garden roof")).toBe(true);
  });
  it("Tab on an empty box, Shift+Tab and other keys leave the box alone", () => {
    expect(customBoxAdds("Tab", false, "   ")).toBe(false);
    expect(customBoxAdds("Tab", true, "Pavers")).toBe(false);
    expect(customBoxAdds("a", false, "Pavers")).toBe(false);
  });
});
