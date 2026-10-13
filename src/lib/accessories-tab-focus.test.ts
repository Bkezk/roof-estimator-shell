/**
 * Tab keeps working after typing a number on the Accessories screens (owner, Oct 13: "the first
 * time you click tab after writing a number in accessories should go to the next form below it
 * and it does most times except after the first time you enter a number"). The cause: the
 * fastener grids were React components defined INSIDE AccessoriesScreens' render function, so
 * every re-render (the commit of a typed number) gave them a new identity, React unmounted the
 * whole grid and the box Tab had just moved into went with it. They are plain render helpers
 * now. Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/accessories-screens.tsx", "utf8");
const body = src.slice(src.indexOf("export function AccessoriesScreens("));

describe("AccessoriesScreens defines no component inside its render", () => {
  it("no capitalised arrow component is declared inside the function", () => {
    // A `const Name = ({ … }: { … }) =>` inside the component is a component with a fresh
    // identity each render — exactly the bug.
    expect(body).not.toMatch(/\n  const [A-Z]\w* = \(/);
    expect(body).not.toContain("<FastenerGrid");
    expect(body).not.toContain("<SubtypeColumn");
  });
  it("the grids are render helpers called inside the tree", () => {
    expect(body).toContain("const fastenerGrid = ({");
    expect(body).toContain("const subtypeColumn = ({");
    expect((body.match(/\{fastenerGrid\(\{/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((body.match(/subtypeColumn\(\{/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // The mapped deck columns keep a key on a Fragment.
    expect(body).toMatch(/<Fragment key=\{c\.title\}>\s*\{subtypeColumn\(\{/);
  });
  it("the number cell still commits on blur, never on every keystroke", () => {
    const num = src.slice(
      src.indexOf("function Num("),
      src.indexOf("/** Read-only white computed cell. */"),
    );
    expect(num).toContain("onBlur={() => {");
    expect(num).toContain("props.onCommit(");
    expect(num).toContain("onChange={(e) => setText(e.target.value)}");
  });
});
