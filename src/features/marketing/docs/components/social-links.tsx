/**
 * Footer social icons. lucide ships no brand marks, so these are inline glyphs.
 * ⚠ PLACEHOLDER HANDLES — confirm Dopl's real accounts before launch.
 */
const LINKS = [
  {
    label: "X",
    href: "https://x.com/usedopl",
    path: "M14.2 2h2.6l-5.7 6.5L17.8 18h-5.3l-4.1-5.4L3.7 18H1.1l6.1-7L.8 2h5.4l3.7 4.9L14.2 2Zm-.9 14.4h1.4L5.4 3.5H3.9l9.4 12.9Z",
  },
  {
    label: "Source code",
    href: "https://github.com/usedopl",
    path: "M9.5 1a8.5 8.5 0 0 0-2.7 16.6c.4.1.6-.2.6-.4v-1.5c-2.4.5-2.9-1-2.9-1-.4-1-.9-1.3-.9-1.3-.8-.5 0-.5 0-.5.9.1 1.3.9 1.3.9.8 1.3 2 1 2.5.7.1-.6.3-1 .6-1.2-1.9-.2-3.9-1-3.9-4.2 0-.9.3-1.7.9-2.3-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.3.9a8 8 0 0 1 4.2 0c1.6-1.1 2.3-.9 2.3-.9.5 1.2.2 2.1.1 2.3.5.6.9 1.4.9 2.3 0 3.3-2 4-3.9 4.2.3.3.6.8.6 1.6v2.3c0 .2.2.5.6.4A8.5 8.5 0 0 0 9.5 1Z",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/usedopl",
    path: "M16.7 1H2.3C1.6 1 1 1.6 1 2.3v14.4c0 .7.6 1.3 1.3 1.3h14.4c.7 0 1.3-.6 1.3-1.3V2.3c0-.7-.6-1.3-1.3-1.3ZM6 15.5H3.5V7H6v8.5ZM4.7 5.8a1.5 1.5 0 1 1 0-2.9 1.5 1.5 0 0 1 0 2.9Zm10.8 9.7H13v-4.1c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.2H7.5V7h2.4v1.2c.3-.6 1.2-1.4 2.5-1.4 2.6 0 3.1 1.7 3.1 4v4.7Z",
  },
];

export function SocialLinks() {
  return (
    <div className="docs-social">
      {LINKS.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          aria-label={l.label}
          className="auth-btn-3d-light"
        >
          <svg viewBox="0 0 19 19" width={16} height={16} aria-hidden>
            <path d={l.path} fill="currentColor" />
          </svg>
        </a>
      ))}
    </div>
  );
}
