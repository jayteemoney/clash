import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Foundry project: Solidity plus a vendored copy of OpenZeppelin's JS test suite. Linted by
    // `forge fmt` / `forge lint`, not by ESLint.
    "contracts/**",

    // Skills installed by `npx skills add`.
    ".agents/**",

    // Generated: see scripts/build-wordlist.mjs and scripts/sync-abi.mjs.
    "lib/games/words.ts",
    "lib/abi/**",
  ]),
]);

export default eslintConfig;
