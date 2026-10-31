import { loadSnapshot } from "../_lib/portal-page";
import { DevicesSection } from "../_sections/devices";

export default async function Page() {
  const { users, metrics } = await loadSnapshot();
  return <DevicesSection users={users} metrics={metrics} />;
}
