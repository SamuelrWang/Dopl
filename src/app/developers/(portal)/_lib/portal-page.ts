import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { computeIssues, type ErrorRow } from "@/features/device-sdk/portal/issues";
import type { PortalOrg, PortalProject } from "@/features/device-sdk/portal/scope";
import type { EndpointView, Issue, MetricRow, PortalUser } from "@/features/device-sdk/portal/view";
import { listPortalOrgs, listPortalProjects } from "@/features/device-sdk/server/portal";
import { readFleet, readMetrics } from "@/features/device-sdk/server/portal-fleet";
import { touchMemberActivity } from "@/features/device-sdk/server/portal-team";
import { readEndpointViews } from "@/features/device-sdk/server/portal-webhooks";
import type { Environment } from "@/features/device-sdk/types";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getUser } from "@/shared/supabase/server";
import { ENV_COOKIE, PROJECT_COOKIE } from "../_components/format";

/**
 * Every `/developers` page starts here. `cache` makes one read per request, shared by the layout's sidebar
 * and the page, so their numbers are the same numbers.
 *
 * The chosen project and environment live in cookies (a layout cannot read the URL, and links stay plain).
 * A cookie is only a wish: the project id is matched against the caller's own projects, never trusted.
 * 🔒 An internal project opens on Live, because that is where all of its traffic is (PLAN section 2).
 */

interface PortalScope {
  userId: string;
  email: string | null;
  projects: PortalProject[];
  project: PortalProject;
  org: PortalOrg;
  env: Environment;
  now: Date;
}

export const loadScope = cache(async (): Promise<PortalScope> => {
  const user = await getUser();
  if (!user) redirect("/login?redirectTo=/developers");
  const [projects, orgs, jar] = await Promise.all([listPortalProjects(user.id), listPortalOrgs(user.id), cookies()]);
  if (projects.length === 0) redirect("/developers/new");
  const wanted = jar.get(PROJECT_COOKIE)?.value;
  const project = projects.find((p) => p.id === wanted) ?? projects[0];
  const envCookie = jar.get(ENV_COOKIE)?.value;
  const env: Environment = envCookie === "live" || envCookie === "test" ? envCookie : project.org.internal ? "live" : "test";
  const org = orgs.find((o) => o.id === project.org.id)!;
  const now = new Date();
  touchMemberActivity(user.id, org.id, now);
  return { userId: user.id, email: user.email ?? null, projects, project, org, env, now };
});

interface PortalSnapshot {
  users: PortalUser[];
  metrics: MetricRow[];
  endpoints: EndpointView[];
  issues: Issue[];
}

const WEEK_MS = 7 * 86_400_000;
const MAX_ERRORS = 2000;

export const loadSnapshot = cache(async (): Promise<PortalSnapshot> => {
  const { project, env, now } = await loadScope();
  const metrics = await readMetrics(project.id, env, now);
  const [users, endpoints, errors] = await Promise.all([
    readFleet({ projectId: project.id, env, internal: project.org.internal, metrics, now }),
    readEndpointViews(project.id, env, now),
    supabaseAdmin()
      .from("dev_events")
      .select("event_id, ts, error_code, external_user_id")
      .eq("project_id", project.id)
      .eq("env", env)
      .neq("outcome", "ok")
      .gte("ts", new Date(now.getTime() - WEEK_MS).toISOString())
      .order("ts", { ascending: false })
      .limit(MAX_ERRORS),
  ]);
  if (errors.error) throw new Error(`loadSnapshot failed: ${errors.error.message}`);
  return { users, metrics, endpoints, issues: computeIssues({ users, endpoints, errors: (errors.data ?? []) as ErrorRow[] }) };
});
