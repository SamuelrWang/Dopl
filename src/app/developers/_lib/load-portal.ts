import "server-only";
import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { listPortalProjects } from "@/features/device-sdk/server/portal";
import {
  parsePortalParams,
  type PortalParams,
  type PortalProject,
  type RawSearchParams,
} from "@/features/device-sdk/portal/scope";

export interface PortalContext {
  userId: string;
  projects: PortalProject[];
  params: PortalParams;
  now: Date;
}

/**
 * Every `/developers` page starts here: the signed-in user (the proxy already gates the route;
 * this is the second fence), the projects they can see, and the URL state checked against them.
 */
export async function loadPortal(searchParams: Promise<RawSearchParams>, path: string): Promise<PortalContext> {
  const user = await getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(path)}`);
  const projects = await listPortalProjects(user.id);
  return { userId: user.id, projects, params: parsePortalParams(await searchParams, projects), now: new Date() };
}
