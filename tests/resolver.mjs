/**
 * Module resolution hook for `node --test`.
 *
 * The app is bundled by Turbopack, which resolves extensionless relative imports and the `@/*`
 * alias. Node's ESM resolver does neither, so tests would otherwise need a parallel set of import
 * paths — and tests that import different files than the app ships are worth very little.
 *
 * This hook teaches Node the same two rules, so the suite runs against the exact source the app
 * uses, with no build step and no test-runner dependency.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  // `@/foo` → `<root>/foo`, matching the tsconfig paths entry.
  if (specifier.startsWith("@/")) {
    const base = join(root, specifier.slice(2));
    const found = existsSync(base) ? base : CANDIDATES.map((ext) => base + ext).find(existsSync);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  if (specifier.startsWith(".")) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : root;
    const base = resolvePath(parent, specifier);
    if (!existsSync(base)) {
      const found = CANDIDATES.map((ext) => base + ext).find(existsSync);
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
