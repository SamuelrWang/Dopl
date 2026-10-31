import { readTeam } from "@/features/device-sdk/server/portal-team";
import { loadScope } from "../_lib/portal-page";
import { TeamSection } from "../_sections/team";

export default async function Page() {
  const { userId, org, now } = await loadScope();
  const { members, invites } = await readTeam(userId, org, now);
  return <TeamSection members={members} invites={invites} />;
}
