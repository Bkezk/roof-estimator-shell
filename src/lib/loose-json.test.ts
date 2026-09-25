import { describe, it, expect } from "vitest";

import { parseLooseJson } from "./loose-json";

describe("parseLooseJson", () => {
  it("parses well-formed JSON untouched", () => {
    expect(parseLooseJson('{"a":"x\\ty","n":[1,2]}')).toEqual({ a: "x\ty", n: [1, 2] });
  });
  it("tolerates a raw control character inside a string (the Perry County answer)", () => {
    const bad = '{"features":[{"attributes":{"NAME":"MAIN\u0001ST","ZIP":"41701"}}]}';
    expect(() => JSON.parse(bad)).toThrow();
    expect(parseLooseJson(bad)).toEqual({
      features: [{ attributes: { NAME: "MAIN ST", ZIP: "41701" } }],
    });
  });
  it("still throws on JSON that is broken for another reason", () => {
    expect(() => parseLooseJson('{"a":')).toThrow();
  });
});
