import { designFont } from "../_design/font";
import { DevicesSection } from "../_sections/devices";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <DevicesSection />
    </div>
  );
}
