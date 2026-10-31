import { designFont } from "../_design/font";
import { UsageSection } from "../_sections/usage";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <UsageSection />
    </div>
  );
}
