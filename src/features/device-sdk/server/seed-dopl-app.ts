import type { Environment } from "../types";

/**
 * SEED "DOPL APP" (W0.1, Plans/Dopl SDK Split). Dopl's own app is an SDK customer: an INTERNAL
 * developer org + project named "Dopl App" on Samuel's developer account, with one live and one
 * test secret key. The app backend holds the live key and calls `/api/v1`, so its traffic shows
 * in the portal logs while `dev_orgs.internal` keeps it out of usage and billing
 * (`dev_billable_events`).
 *
 * IDEMPOTENT: every run converges on one internal org, one owner membership, one project, and at
 * least one usable secret key per env. An env that already has a usable key is KEPT, never
 * re-minted: a raw key is shown once at mint and cannot be shown again. Rotate on purpose
 * (portal or `rotateApiKey`), not by re-running the seed.
 *
 * DRY RUN by default (`apply: false`): reads only and reports what it would do.
 *
 * ⚠ The minted raw keys come back in `minted[].secret` for the caller to print ONCE to a terminal.
 * Never log, store, commit or post them.
 *
 * The store is a port so the logic is tested without a database; the Supabase implementation is
 * `seed-dopl-app-store.ts`. Runner: `scripts/seed-dopl-app.mts`.
 */

export const DOPL_APP_NAME = "Dopl App";
/** The secret keys the app needs: live for the backend, test for development. */
export const DOPL_APP_KEY_ENVS: readonly Environment[] = ["live", "test"];

export interface SeedOrg {
  id: string;
  internal: boolean;
}

/** A secret key as the seed sees it. Never the raw key or its hash. */
export interface SeedKey {
  id: string;
  env: Environment;
  prefix: string;
}

export interface DoplAppSeedStore {
  findOrgs(ownerUserId: string, name: string): Promise<SeedOrg[]>;
  /** Creates the org with `internal = true`. */
  createInternalOrg(ownerUserId: string, name: string): Promise<SeedOrg>;
  markOrgInternal(orgId: string): Promise<void>;
  hasOwnerMember(orgId: string, userId: string): Promise<boolean>;
  addOwnerMember(orgId: string, userId: string): Promise<void>;
  findProjects(orgId: string, name: string): Promise<Array<{ id: string }>>;
  createProject(orgId: string, name: string): Promise<{ id: string }>;
  /** Secret keys of this env that work now: not revoked, not expired. */
  listUsableSecretKeys(projectId: string, env: Environment, now: Date): Promise<SeedKey[]>;
  mintSecretKey(projectId: string, env: Environment): Promise<{ secret: string; key: SeedKey }>;
}

export interface SeedStep {
  action: "keep" | "create" | "update" | "mint";
  what: string;
}

export interface SeedResult {
  applied: boolean;
  /** Null only on a dry run that would create it. */
  orgId: string | null;
  projectId: string | null;
  steps: SeedStep[];
  /** Usable keys that were already there (kept). */
  kept: SeedKey[];
  /** Keys minted by this run. `secret` is shown once: print it to a terminal, nowhere else. */
  minted: Array<SeedKey & { secret: string }>;
}

export async function seedDoplApp(
  store: DoplAppSeedStore,
  input: { ownerUserId: string; apply: boolean; now?: Date }
): Promise<SeedResult> {
  const { ownerUserId, apply } = input;
  const now = input.now ?? new Date();
  const result: SeedResult = { applied: apply, orgId: null, projectId: null, steps: [], kept: [], minted: [] };
  const step = (action: SeedStep["action"], what: string) => result.steps.push({ action, what });

  // 1. Org: exactly one "Dopl App" owned by this account, flagged internal.
  const orgs = await store.findOrgs(ownerUserId, DOPL_APP_NAME);
  if (orgs.length > 1) {
    throw new Error(`seedDoplApp: ${orgs.length} orgs named "${DOPL_APP_NAME}" for this owner; resolve by hand`);
  }
  let org = orgs[0] ?? null;
  if (!org) {
    step("create", `internal org "${DOPL_APP_NAME}"`);
    if (apply) org = await store.createInternalOrg(ownerUserId, DOPL_APP_NAME);
  } else if (!org.internal) {
    step("update", `org ${org.id}: internal = true`);
    if (apply) await store.markOrgInternal(org.id);
  } else {
    step("keep", `internal org ${org.id}`);
  }
  if (!org) {
    // Dry run with nothing yet: everything below would be created.
    step("create", "owner membership");
    step("create", `project "${DOPL_APP_NAME}"`);
    for (const env of DOPL_APP_KEY_ENVS) step("mint", `${env} secret key`);
    return result;
  }
  result.orgId = org.id;

  // 2. Owner membership.
  if (await store.hasOwnerMember(org.id, ownerUserId)) {
    step("keep", "owner membership");
  } else {
    step("create", "owner membership");
    if (apply) await store.addOwnerMember(org.id, ownerUserId);
  }

  // 3. Project.
  const projects = await store.findProjects(org.id, DOPL_APP_NAME);
  if (projects.length > 1) {
    throw new Error(`seedDoplApp: ${projects.length} projects named "${DOPL_APP_NAME}" in org ${org.id}; resolve by hand`);
  }
  let project = projects[0] ?? null;
  if (!project) {
    step("create", `project "${DOPL_APP_NAME}"`);
    if (apply) project = await store.createProject(org.id, DOPL_APP_NAME);
  } else {
    step("keep", `project ${project.id}`);
  }
  if (!project) {
    for (const env of DOPL_APP_KEY_ENVS) step("mint", `${env} secret key`);
    return result;
  }
  result.projectId = project.id;

  // 4. Keys: keep any usable one per env; mint only where none works.
  for (const env of DOPL_APP_KEY_ENVS) {
    const usable = await store.listUsableSecretKeys(project.id, env, now);
    if (usable.length > 0) {
      step("keep", `${env} secret key(s) ${usable.map((k) => k.prefix).join(", ")}`);
      result.kept.push(...usable);
      continue;
    }
    step("mint", `${env} secret key`);
    if (apply) {
      const { secret, key } = await store.mintSecretKey(project.id, env);
      result.minted.push({ ...key, secret });
    }
  }
  return result;
}
