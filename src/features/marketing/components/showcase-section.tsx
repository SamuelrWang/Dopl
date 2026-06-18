import Link from "next/link";

import {
  APP_TILES,
  PHONE_BUBBLES,
  PHONE_NAME,
  PHONE_PLACEHOLDER,
  SHOWCASE,
} from "../constants";
import { ImageSlot } from "./image-slot";

const APPLE_PATH =
  "M16.36 12.78c-.02-2.4 1.96-3.55 2.05-3.61-1.12-1.63-2.86-1.86-3.48-1.88-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.62.02-3.11.94-3.94 2.39-1.68 2.91-.43 7.22 1.21 9.58.8 1.16 1.76 2.46 3.01 2.41 1.21-.05 1.67-.78 3.13-.78 1.46 0 1.87.78 3.14.76 1.3-.02 2.12-1.18 2.92-2.34.92-1.34 1.3-2.64 1.32-2.71-.03-.01-2.53-.97-2.56-3.85zM14.4 5.7c.66-.8 1.11-1.92.99-3.03-.95.04-2.11.63-2.8 1.43-.61.71-1.15 1.84-1 2.93 1.06.08 2.15-.54 2.81-1.33z";

/** Dark section — cross-platform reach, the streaming app tiles, phone mock. */
export function ShowcaseSection() {
  return (
    <section className="dark">
      <div className="wrap">
        <div className="platform-pills">
          <span className="ppill">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d={APPLE_PATH} />
            </svg>
            Mac
          </span>
          <span className="ppill">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 5.1 10.5 4v7.5H3zM11.5 3.85 21 2.5v9H11.5zM3 12.5h7.5V20L3 18.9zM11.5 12.5H21v9l-9.5-1.35z" />
            </svg>
            Windows
          </span>
          <span className="ppill">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d={APPLE_PATH} />
            </svg>
            iPhone
          </span>
          <span className="ppill">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 9h12v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 17zM4 9.5v6a1.2 1.2 0 0 0 2.4 0v-6a1.2 1.2 0 0 0-2.4 0zm13.6 0v6a1.2 1.2 0 0 0 2.4 0v-6a1.2 1.2 0 0 0-2.4 0zM8.5 20v2.2a1.1 1.1 0 0 0 2.2 0V20zm4.8 0v2.2a1.1 1.1 0 0 0 2.2 0V20zM7.5 8c.2-2 1.8-3.6 4-4l-.9-1.6 1-.6.95 1.7c.78-.25 1.62-.25 2.4 0l.95-1.7 1 .6L17 4c2.2.4 3.8 2 4 4z" />
            </svg>
            Android
          </span>
        </div>

        <h2 className="serif">{SHOWCASE.heading}</h2>
        <p className="dsub">{SHOWCASE.sub}</p>
        <Link className="btn-watch" href="/login">
          {SHOWCASE.cta}
        </Link>
      </div>

      <div className="icon-stream">
        {APP_TILES.map((t, i) => (
          <div
            key={i}
            className={t.s < 1 ? "app-ic sm" : "app-ic"}
            style={{
              left: `calc(${t.x}vw)`,
              top: `${t.y}%`,
              transform: `rotate(${t.r}deg) scale(${t.s})`,
              background: t.bg,
              color: t.fg,
            }}
          >
            {t.glyph}
          </div>
        ))}
      </div>

      <div className="phone">
        <div className="ph-top">
          <div className="ph-av">
            <ImageSlot shape="circle" />
          </div>
          <div className="ph-name">{PHONE_NAME}</div>
        </div>
        <div className="bubbles">
          {PHONE_BUBBLES.map((b, i) => (
            <div
              key={i}
              className={`bub ${b.side}${b.dim ? " dim" : ""}`}
            >
              {b.text}
            </div>
          ))}
        </div>
        <div className="ph-input">
          <div className="pi-field">{PHONE_PLACEHOLDER}</div>
          <div className="pi-mic">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#15130d"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="21" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
