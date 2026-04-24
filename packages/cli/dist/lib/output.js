"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJson = writeJson;
exports.writeLine = writeLine;
exports.writeError = writeError;
exports.formatTable = formatTable;
exports.truncate = truncate;
exports.formatDateCompact = formatDateCompact;
function writeJson(value) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
function writeLine(text = "") {
    process.stdout.write(text + "\n");
}
function writeError(text) {
    process.stderr.write(text + "\n");
}
function formatTable(headers, rows) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
    const render = (cells) => cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();
    const lines = [];
    lines.push(render(headers));
    lines.push(render(widths.map((w) => "─".repeat(w))));
    for (const row of rows)
        lines.push(render(row));
    return lines.join("\n");
}
function truncate(text, max) {
    if (!text)
        return "";
    if (text.length <= max)
        return text;
    return text.slice(0, Math.max(0, max - 1)) + "…";
}
function formatDateCompact(iso) {
    if (!iso)
        return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return "—";
    return d.toISOString().slice(0, 10);
}
