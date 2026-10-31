import { loadSnapshot } from "../_lib/portal-page";
import { UsersSection } from "../_sections/users";

export default async function Page() {
  const { users } = await loadSnapshot();
  return <UsersSection users={users} />;
}
