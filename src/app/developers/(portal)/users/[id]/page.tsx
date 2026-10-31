import { notFound } from "next/navigation";
import { readCalls } from "@/features/device-sdk/server/portal-activity";
import { designFont } from "../../_design/font";
import { loadScope, loadSnapshot } from "../../_lib/portal-page";
import { UserPageSection } from "../../_sections/user-page";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }, { project, env }, { users }] = await Promise.all([params, searchParams, loadScope(), loadSnapshot()]);
  const user = users.find((u) => u.id === decodeURIComponent(id));
  if (!user) notFound();
  const calls = await readCalls({ projectId: project.id, env, internal: project.org.internal });
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <UserPageSection user={user} calls={calls} initialTab={tab} />
    </div>
  );
}
