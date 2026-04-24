export interface OutputOptions {
  json: boolean;
}

export function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function writeLine(text = ""): void {
  process.stdout.write(text + "\n");
}

export function writeError(text: string): void {
  process.stderr.write(text + "\n");
}

export function formatTable(
  headers: string[],
  rows: string[][]
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const render = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();

  const lines: string[] = [];
  lines.push(render(headers));
  lines.push(render(widths.map((w) => "─".repeat(w))));
  for (const row of rows) lines.push(render(row));
  return lines.join("\n");
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

export function formatDateCompact(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
