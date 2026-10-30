import { designFont } from "../_design/font";
import { KeysSection } from "../_sections/keys";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <KeysSection />
    </div>
  );
}
