import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { NewOrgForm } from "./new-org-form";

/**
 * `/developers/new`: a developer signs up with a Dopl account (the proxy sends a signed-out visitor to sign
 * in or sign up and back here), then names an org and its first project. Sits outside `(portal)`, whose
 * layout needs a project to open.
 */
export default async function NewOrgPage() {
  if (!(await getUser())) redirect("/login?redirectTo=/developers/new");
  return <NewOrgForm />;
}
