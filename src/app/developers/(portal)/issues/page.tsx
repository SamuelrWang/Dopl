import { loadSnapshot } from "../_lib/portal-page";
import { IssuesSection } from "../_sections/issues";

export default async function Page() {
  const { issues, users } = await loadSnapshot();
  return <IssuesSection issues={issues} users={users} />;
}
