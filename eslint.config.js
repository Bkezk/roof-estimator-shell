import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // src/integrations is written by Lovable's sync in its own style (single quotes, no semicolons
  // in places); it is typechecked but not linted so its regeneration cannot turn CI red.
  { ignores: ["dist", ".output", ".vinxi", "src/integrations/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Module boundaries (MODULES.md rule 2): the estimator and prospecting never import each
  // other. They share only the `bids` link columns and plain URL values.
  {
    files: [
      "src/routes/estimate.tsx",
      "src/routes/bids.tsx",
      "src/routes/proposal.tsx",
      "src/lib/engine/**",
      "src/lib/bids.functions.ts",
      "src/lib/proposal-bid.ts",
      "src/lib/combine-bids.ts",
      "src/components/*-screen.tsx",
      "src/components/*-screens.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/prospect*", "@/components/prospect*", "**/prospect*"],
              message: "Estimator code never imports prospecting code (MODULES.md).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/prospect*", "src/components/prospect*", "src/routes/prospect*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/engine/*",
                "@/lib/bids.functions",
                "@/lib/proposal-bid",
                "@/lib/combine-bids",
                "@/routes/estimate",
                "@/components/*-screen",
                "@/components/*-screens",
              ],
              message: "Prospecting code never imports estimator code (MODULES.md).",
            },
          ],
        },
      ],
    },
  },
  eslintPluginPrettier,
);
