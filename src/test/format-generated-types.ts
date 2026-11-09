/**
 * Vitest global setup: a prettier-formatted copy of the generated database types for the tests
 * that pin them (see generated-types.ts). The generated file itself is never touched.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as prettier from "prettier";

import { FORMATTED_TYPES_PATH, GENERATED_TYPES_PATH } from "./generated-types";

export default async function formatGeneratedTypes(): Promise<void> {
  const file = resolve(GENERATED_TYPES_PATH);
  const src = readFileSync(file, "utf8");
  const config = (await prettier.resolveConfig(file)) ?? {};
  const out = await prettier.format(src, { ...config, parser: "typescript", filepath: file });
  mkdirSync(dirname(resolve(FORMATTED_TYPES_PATH)), { recursive: true });
  writeFileSync(resolve(FORMATTED_TYPES_PATH), out);
}
