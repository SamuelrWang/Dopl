import { designFont } from "../_design/font";
import { UsersSection } from "../_sections/users";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <UsersSection />
    </div>
  );
}
