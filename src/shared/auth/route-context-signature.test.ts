/**
 * COMPILE-TIME PIN — the second parameter of the handler `withUserAuth` (and,
 * through it, `withMcpAccess` / `withWorkspaceAuth`) returns. That returned
 * function is what every `src/app/api/**` route exports as `GET`/`POST`/…, so
 * its signature is checked by Next, not only by us.
 *
 * THE BUG THIS WOULD HAVE CAUGHT (finding #8 / ruling R8, measured 2026-08-25):
 * the wrapper declared `routeContext?: { params?: Promise<…> }`. Next lazily
 * generates, per route it compiles in dev, `.next/dev/types/app/api/**\/route.ts`
 * asserting `SecondArg<HANDLER>` extends `RouteContext`; `tsconfig.json`
 * INCLUDES `.next/dev/types/**\/*.ts`. `SecondArg` is inferred from the
 * parameter tuple, so an optional parameter yields `… | undefined` and every
 * wrapped route the dev server had served went red under `npm run typecheck`
 * (31 errors). CI never saw it — a clean checkout has no `.next/` — so the gate
 * was red only on the machine running the mandated always-on dev stack.
 *
 * TWO THINGS MUST STAY REQUIRED, and each is pinned below:
 *   1. the PARAMETER (an optional one — including one given a default value,
 *      which does NOT make a parameter required in the function type — admits
 *      `undefined`, which is not a `RouteContext`);
 *   2. the `params` PROPERTY (`Promise<…> | undefined` is not assignable to
 *      `Promise<SegmentParams>`).
 *
 * The types below are a VERBATIM mirror of what Next 16.2.2 generates; a test
 * cannot import from `.next/` (generated, and absent on a clean checkout). If
 * Next changes the shape, re-copy it from any
 * `.next/dev/types/app/api/**\/route.ts` after the dev server has served that
 * route. Type-only imports — nothing here executes the auth spine.
 */

import { describe, it, expect } from "vitest";
import type { withUserAuth } from "./with-auth";
import type { withWorkspaceAuth } from "./with-workspace-auth";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-wrapper-object-types --
   verbatim copy of Next's generated checker; deviating from it would pin a
   different constraint than the one that actually fails. */

/** `.next/dev/types/app/api/**\/route.ts`. Resolves to `any` (the `T = any`
 *  default distributes over both branches) — kept literal for fidelity. */
type SegmentParams<T extends Object = any> = T extends Record<string, any>
  ? { [K in keyof T]: T[K] extends string ? string | string[] | undefined : never }
  : T;

/** The constraint Next applies via `ParamCheck<RouteContext>`. */
type RouteContext = { params: Promise<SegmentParams> };

/** How Next extracts the parameter it constrains — inference over the parameter
 *  TUPLE is why optionality leaks `undefined` in. */
type SecondArg<T> = T extends (...args: [any, infer U]) => any
  ? unknown extends U
    ? any
    : U
  : never;

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-wrapper-object-types */

describe("route-handler signature — Next `ParamCheck<RouteContext>`", () => {
  it("withUserAuth's returned handler takes a required RouteContext-shaped 2nd arg", () => {
    const secondArg: SecondArg<ReturnType<typeof withUserAuth>> = {
      params: Promise.resolve({}),
    };
    // ⚠ THE PIN. Red at `npm run typecheck` if the parameter, or `params`,
    // goes optional again — exactly what Next's generated file reports.
    const asRouteContext: RouteContext = secondArg;
    expect(asRouteContext.params).toBeInstanceOf(Promise);
  });

  it("withWorkspaceAuth's returned handler does too (it composes withUserAuth)", () => {
    const secondArg: SecondArg<ReturnType<typeof withWorkspaceAuth>> = {
      params: Promise.resolve({}),
    };
    const asRouteContext: RouteContext = secondArg;
    expect(asRouteContext.params).toBeInstanceOf(Promise);
  });
});
