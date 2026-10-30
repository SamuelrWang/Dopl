import { PlaygroundSection } from "../_sections/playground";

export default async function Page({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const { model } = await searchParams;
  return <PlaygroundSection initialModel={model} />;
}
