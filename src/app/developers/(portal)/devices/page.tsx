import { designFont } from "../_design/font";
import { loadSnapshot } from "../_lib/portal-page";
import { DevicesSection } from "../_sections/devices";

export default async function Page() {
  const { users, metrics } = await loadSnapshot();
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <DevicesSection users={users} metrics={metrics} />
    </div>
  );
}
