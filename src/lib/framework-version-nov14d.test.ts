/**
 * Security audit, Nov 14. Owner: "Go with 3".
 *
 * The site ran TanStack Start 1.168.32. Its maker lists every version below 1.168.60 as open to
 * a crafted link that makes the site answer with someone else's page (CVE-2026-102989), and the
 * data format underneath it (seroval, up to 1.6.7) as open to several more. These pins keep the
 * site from sliding back below the fixed versions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
};
const installed = (name: string) =>
  (JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")) as { version: string })
    .version;
/** Is version `a` at least `b`? Plain numbers, three parts. */
function atLeast(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return true;
}

describe("the framework is at a fixed version", () => {
  it("the comparison itself works", () => {
    expect(atLeast("1.168.60", "1.168.60")).toBe(true);
    expect(atLeast("1.169.5", "1.168.60")).toBe(true);
    expect(atLeast("1.168.32", "1.168.60")).toBe(false);
    expect(atLeast("1.8.1", "1.6.8")).toBe(true);
  });
  it("package.json names an exact version, at or above the first fixed one", () => {
    const v = pkg.dependencies["@tanstack/react-start"]!;
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(atLeast(v, "1.168.60")).toBe(true);
  });
  it.each([
    ["@tanstack/react-start", "1.168.60"],
    ["@tanstack/start-server-core", "1.169.39"],
    ["seroval", "1.6.8"],
  ])("what is installed: %s is at least %s", (name, fixed) => {
    expect(atLeast(installed(name), fixed)).toBe(true);
  });
});

describe("the error screen takes whatever was thrown", () => {
  it("as the updated router hands it over", () => {
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toContain(
      "function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {",
    );
  });
});
