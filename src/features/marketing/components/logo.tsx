import Link from "next/link";
import { BRAND } from "../constants";

/** Brand lockup. Must match login screen. */
export function Logo() {
  return (
    <Link href="/" className="lp-brand" aria-label={BRAND}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicons/android-chrome-512x512.png"
        alt={BRAND}
        className="lp-brand-mark auth-logo-3d"
        width={26}
        height={26}
      />
      <span className="lp-brand-word">{BRAND}</span>
    </Link>
  );
}
