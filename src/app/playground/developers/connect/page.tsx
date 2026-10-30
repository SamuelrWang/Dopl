import { designFont } from "../_design/font";
import { ConnectSection } from "../_sections/connect";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <ConnectSection />
    </div>
  );
}
