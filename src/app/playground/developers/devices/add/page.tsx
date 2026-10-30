import { AddDeviceSection } from "../../_sections/add-device";

export default async function Page({ searchParams }: { searchParams: Promise<{ integration?: string }> }) {
  const { integration } = await searchParams;
  return <AddDeviceSection initial={integration} />;
}
