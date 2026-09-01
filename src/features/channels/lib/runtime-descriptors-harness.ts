/**
 * THE THREE REAL RUNTIME DESCRIPTORS, LOADED FROM THE ADAPTERS THEMSELVES.
 *
 * ⚠ NOT FIXTURES, AND THAT IS THE WHOLE POINT. A hand-written `{session:{interrupt:
 * 'unverified'}}` proves that the web helper reads a field; it proves nothing about
 * whether CURSOR still declares that field, which is the claim every §3.2 assertion
 * is actually making. Driving `main/runtime/index.js › all()` means a descriptor
 * change on the desktop side fails these suites — the only place a UI built on
 * declared data can be pinned at all.
 *
 * ⚠ IT IS A `require`, NOT AN IMPORT, and it is deliberate on three counts: the
 * adapters are CommonJS, they live outside the root `tsconfig` program, and
 * `contract.js › sealAdapter` DEEP-FREEZES every descriptor and refuses to seal one
 * carrying a function — so what comes back is inert data, exactly as it is after the
 * structured-clone hop to the renderer.
 *
 * ⚠ OFF `process.cwd()` (the vitest root), NOT `import.meta.url`. Under the jsdom
 * environment these suites declare, a module-relative URL misses the tree — the same
 * rule and the same reason `channels-v2/settings-agent-harness.tsx › desktopSource`
 * states over its own read.
 *
 * ⚠ NOT A `*.test.ts` NAME ON PURPOSE — `vitest.config.ts` includes exactly
 * `src/**​/*.test.ts(x)`, so this file is imported and never collected.
 */

import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { RuntimeDescriptor } from "./runtime-capability";

const requireFromRoot = createRequire(resolve(process.cwd(), "package.json"));

interface Registry {
  all: () => Array<{ descriptor: RuntimeDescriptor }>;
  DEFAULT_ID: string;
}

const registry = requireFromRoot(
  resolve(process.cwd(), "dopl-desktop-app/main/runtime")
) as Registry;

/** Every registered adapter's descriptor, in REGISTRY ORDER. ⚠ The order is the
 *  one the wire hands over and the one the Runtime row renders. */
export const REAL_DESCRIPTORS: ReadonlyArray<RuntimeDescriptor> = registry
  .all()
  .map((a) => a.descriptor);

/** The adapter a channel with no pick launches on. */
export const REAL_DEFAULT_RUNTIME = registry.DEFAULT_ID;

/**
 * One descriptor by id. ⚠ IT THROWS RATHER THAN ANSWERING `undefined`: a suite that
 * silently ran against `undefined` would pass every hide-on-absent assertion in the
 * file for the wrong reason, which is the exact failure mode these tests exist to
 * catch elsewhere.
 */
export function realDescriptor(id: string): RuntimeDescriptor {
  const found = REAL_DESCRIPTORS.find((d) => d.id === id);
  if (!found) {
    throw new Error(
      `no adapter registered as "${id}" — registered: ${REAL_DESCRIPTORS.map((d) => d.id).join(", ")}`
    );
  }
  return found;
}
