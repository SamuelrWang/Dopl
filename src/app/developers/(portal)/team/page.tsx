import { readTeam } from "@/features/device-sdk/server/portal-team";
import { designFont } from "../_design/font";
import { loadScope } from "../_lib/portal-page";
import { TeamSection } from "../_sections/team";

export default async function Page() {
  const { userId, org, now } = await loadScope();
  const { members, invites } = await readTeam(userId, org, now);
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <TeamSection members={members} invites={invites} />
    </div>
  );
}
