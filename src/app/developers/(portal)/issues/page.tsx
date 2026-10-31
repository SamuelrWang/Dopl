import { designFont } from "../_design/font";
import { loadSnapshot } from "../_lib/portal-page";
import { IssuesSection } from "../_sections/issues";

export default async function Page() {
  const { issues, users } = await loadSnapshot();
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <IssuesSection issues={issues} users={users} />
    </div>
  );
}
