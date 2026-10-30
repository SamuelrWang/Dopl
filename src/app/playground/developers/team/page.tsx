import { designFont } from "../_design/font";
import { TeamSection } from "../_sections/team";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <TeamSection />
    </div>
  );
}
