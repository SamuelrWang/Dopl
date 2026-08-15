/**
 * Human-readable byte sizes for the usage meters.
 *
 * DECIMAL UNITS (1 kB = 1000 B), matching `features/billing/kb-storage.ts ›
 * KB_STORAGE_BYTES`, which states the caps as round decimal megabytes so the
 * limit renders as "5 MB" and not "4.8 MB". Rendering the used side in MiB
 * while the cap is decimal is the one bug this pairing exists to prevent.
 *
 * No framework, no locale table: this is a pure string builder so the same
 * function can format a server-side denial message and a client-side bar
 * caption without either importing the other's world.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * `4_231_000` → `"4.2 MB"`, `512` → `"512 B"`, `5_000_000` → `"5 MB"`.
 *
 * ONE decimal place, and a trailing `.0` is dropped — a cap of exactly 5 MB
 * must not read "5.0 MB" beside a used value of "4.2 MB", because the pair is
 * the whole message. Bytes never get a fraction (there is no such thing as
 * half a byte to a reader). Negative or non-finite input reads "0 B": the
 * counter is clamped at zero in SQL, so a negative here means the number is
 * wrong, and inventing a minus sign in the UI helps nobody.
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
