import { designFont } from "../_design/font";
import { PlaygroundSection } from "../_sections/playground";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <PlaygroundSection />
    </div>
  );
}
