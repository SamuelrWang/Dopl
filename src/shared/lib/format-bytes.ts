/**
 * Human-readable byte sizes for the usage meters.
 *
 * ⚠ DECIMAL UNITS (1 kB = 1000 B), matching `features/billing/kb-storage.ts ›
 * KB_STORAGE_BYTES`, whose caps are round decimal megabytes so a limit renders
 * "5 MB" not "4.8 MB". Rendering the used side in MiB against a decimal cap is
 * the bug this pairing prevents.
 *
 * ⚠ Pure string builder, no framework or locale table, so the same function
 * formats a server-side denial message and a client-side bar caption.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * `4_231_000` → `"4.2 MB"`, `512` → `"512 B"`, `5_000_000` → `"5 MB"`.
 *
 * ONE decimal place, trailing `.0` dropped — a 5 MB cap must not read "5.0 MB"
 * beside a used value of "4.2 MB". Bytes never get a fraction. Negative or
 * non-finite reads "0 B" (the counter is clamped at zero in SQL, so a negative
 * means the number is wrong).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}
