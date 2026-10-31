import { designFont } from "../_design/font";
import { PlaygroundSection } from "../_sections/playground";

export default async function Page({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const { model } = await searchParams;
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <PlaygroundSection initialModel={model} />
    </div>
  );
}
