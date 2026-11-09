/**
 * The generated database types as the tests read them. Lovable regenerates
 * src/integrations/supabase/types.ts in its own style (no semicolons, since Nov 9), and the repo
 * never formats that file; the tests pin columns and functions in the repo's style ("folder:
 * string | null;"), so the Vitest global setup (format-generated-types.ts) formats a copy with
 * prettier once per run and the tests read that copy. Without the copy (a lone test run outside
 * Vitest) the raw file is returned.
 */
import { existsSync, readFileSync } from "node:fs";

export const GENERATED_TYPES_PATH = "src/integrations/supabase/types.ts";
export const FORMATTED_TYPES_PATH = "node_modules/.cache/jbk-tests/types.formatted.ts";

export function readGeneratedTypes(): string {
  if (existsSync(FORMATTED_TYPES_PATH)) return readFileSync(FORMATTED_TYPES_PATH, "utf8");
  return readFileSync(GENERATED_TYPES_PATH, "utf8");
}

/**
 * The types with their formatting flattened — semicolons dropped, whitespace collapsed, none
 * around braces, colons, commas, pipes — so a pin reads the same whether prettier put a short
 * type on one line or the generator spread it over several.
 */
export const flatTypes = (s: string): string =>
  s
    .replace(/;/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:,|?[\]()])\s*/g, "$1")
    .trim();

/** Does the types text carry the snippet, formatting aside? */
export const typesInclude = (types: string, snippet: string): boolean =>
  flatTypes(types).includes(flatTypes(snippet));

/**
 * One table's, view's or function's block (`      name: {` to its closing `      };`), as the
 * generator writes it — alphabetical, so slicing to "the next table" by name no longer works.
 */
export function typesBlock(types: string, name: string): string {
  const at = types.indexOf(`\n      ${name}: {\n`);
  if (at < 0) return "";
  const end = types.indexOf("\n      };\n", at);
  return end < 0 ? types.slice(at + 1) : types.slice(at + 1, end + "\n      };\n".length);
}
