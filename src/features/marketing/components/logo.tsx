import { BRAND } from "../constants";

/** Brand lockup: the raised Dopl app icon + wordmark, matching the login screen. */
export function Logo() {
  return (
    <a href="/" className="lp-brand" aria-label={BRAND}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicons/android-chrome-512x512.png"
        alt={BRAND}
        className="lp-brand-mark auth-logo-3d"
        width={26}
        height={26}
      />
      <span className="lp-brand-word">{BRAND}</span>
    </a>
  );
}
