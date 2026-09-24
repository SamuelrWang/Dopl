/**
 * ⚠ THE ONTOLOGY'S RETIRED WIRE NAMES — for released desktops only, and deleted with them.
 *
 * Samuel, 2026-09-23: *"The word "cluster" is obsolete, so it needs to be completely removed."*
 * The app, the API, the SDK, the MCP surface and the database all say ONTOLOGY since then. A
 * desktop build at or below {@link LEGACY_LAST_VERSION} bundles an SPA that still calls the old
 * routes, sends the old body field and reads the old response keys, so this module — and the
 * four alias route files under `src/app/api/ontology/clusters/` that call it — keep that build's
 * ontology page working until it updates. It is the ONE place in live web code that spells the
 * old word; `src/features/ontology/vocabulary.test.ts` exempts exactly these files.
 *
 * ⚠ ADDITIVE ONLY. Nothing here renames a new key or drops one: an alias adds the old name beside
 * the new, so a new client reading a legacy-shaped answer is unaffected.
 *
 * ⚠ REMOVAL TRIGGER: the release after `shared/version/desktop-floor.ts › DEFAULT_MIN_VERSION`
 * reaches the first build that speaks the new names (1.37.0). Delete this file, the
 * `src/app/api/ontology/clusters/` tree, and the two call sites (`api/ontology/route.ts`,
 * `api/ontology/objects/route.ts`), then drop the exemption.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { OntologyObjectCreateSchema } from "./schema";

/** The last desktop build that speaks the retired names. */
const LEGACY_LAST_VERSION = "1.36.0";

/** The retired names, each beside its successor. */
const OLD_ID_PARAM = "clusterId";
const OLD_ONE_KEY = "cluster";
const OLD_LIST_KEY = "clusters";
const OLD_PERSONAL_KEY = "personalClusterIds";

function triple(v: string): [number, number, number] | null {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const LEGACY_LAST = triple(LEGACY_LAST_VERSION) as [number, number, number];

/**
 * Does this request come from a desktop that reads the old response keys? Only a desktop sends
 * `X-Dopl-App-Version`, and it is a diagnostic claim, never authz — the worst a forged value buys
 * is two duplicate keys.
 */
export function isLegacyOntologyClient(appVersion: string | undefined): boolean {
  if (!appVersion) return false;
  const have = triple(appVersion);
  if (!have) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== LEGACY_LAST[i]) return have[i] < LEGACY_LAST[i];
  }
  return true;
}

/** `GET /api/ontology` (both views): the list and the personal-shelf ids under their old keys too. */
export function withLegacySnapshotKeys<
  T extends { ontologies: readonly unknown[]; personalOntologyIds?: readonly string[] },
>(body: T, appVersion: string | undefined): T {
  if (!isLegacyOntologyClient(appVersion)) return body;
  const legacy: Record<string, unknown> = { ...body, [OLD_LIST_KEY]: body.ontologies };
  if (body.personalOntologyIds !== undefined) legacy[OLD_PERSONAL_KEY] = body.personalOntologyIds;
  return legacy as T;
}

/** `POST /api/ontology/objects`: the old body named the parent ontology under the old key. */
export const LegacyTolerantObjectCreateSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const body = raw as Record<string, unknown>;
  if (!(OLD_ID_PARAM in body) || "ontologyId" in body) return raw;
  const { [OLD_ID_PARAM]: ontologyId, ...rest } = body;
  return { ...rest, ontologyId };
}, OntologyObjectCreateSchema);

type SegmentContext = { params: Promise<Record<string, string>> };
type RouteHandler = (request: NextRequest, context: SegmentContext) => Promise<Response>;

/**
 * An old route, answered by its successor: the segment param is re-keyed on the way in, and a
 * JSON body carrying `ontology` gains the old single-row key on the way out.
 */
export function legacyOntologyRoute(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    const params = context?.params
      ? context.params.then((p) => {
          const { [OLD_ID_PARAM]: ontologyId, ...rest } = p ?? {};
          return ontologyId === undefined ? rest : { ...rest, ontologyId };
        })
      : Promise.resolve({});
    const res = await handler(request, { params });
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
    const body: unknown = await res.clone().json().catch(() => null);
    if (!body || typeof body !== "object" || !("ontology" in body)) return res;
    return NextResponse.json(
      { ...body, [OLD_ONE_KEY]: (body as { ontology: unknown }).ontology },
      { status: res.status, headers: res.headers }
    );
  };
}
