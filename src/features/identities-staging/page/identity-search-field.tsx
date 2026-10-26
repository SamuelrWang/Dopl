"use client";

/**
 * THE PAGE'S SEARCH FIELD — item 7, fix 3 (Samuel, 2026-10-22: *"That search bar is just not good,
 * right? Look at the other search bars. The other search bar is kind of rounded, right, so it
 * should be a lot better than that"*).
 *
 * 🔒 **IT IS NOT A FOURTH SEARCH INPUT. IT IS THE APP'S OWN ONE, REUSED.** "The other search bar"
 * is /home's, and /home's is the kit recipe `.search-expand` + `.search-expand-shell` +
 * `.search-expand-input` (`globals.css`, a 6/7 scale of the landing nav's pill): a full 9999px
 * pill, the raised light face (`.auth-btn-3d-light`), the glyph parked at the leading edge, and
 * `--raised-light-focus` on focus. `apps/desktop-ui/src/pages/home/home-search.tsx` wears exactly
 * these four classes; so does this. **No new CSS, no literals, nothing hand-rolled** — which is
 * the §4d lesson ("inventory the existing component library and REUSE it") applied before writing
 * anything.
 *
 * That reuse also settles item 7's other two constraints for free:
 * - **No `--bg-inset`.** The old field was `bg-bg-inset` (`#f1f1f1`), the exact grey Samuel
 *   pointed at. The raised face is a white gradient.
 * - **Not concave.** `.concave-field` (the kit's `SearchField`) is BANNED on /home and swept by
 *   `agent-identities/components/identity-editor-surface.test.tsx`. The search pill was already
 *   the sanctioned answer to that, stated in `globals.css`: *"No inner concave well… Only
 *   `.concave-field`'s focus signal is borrowed"*.
 *
 * Two deltas from `home-search.tsx`, both because this field is a FILTER and that one is a popup
 * host: it is always expanded with no popup attached (`data-open` is pinned true, as there is no
 * collapsed state to animate out of), and it carries a clear (×) once there is a value, because a
 * filter you cannot drop traps the grid.
 *
 * PORT TARGET: the staged file this becomes in the product is a sibling of `home-search.tsx` in
 * `pages/home/`; it needs no kit change, since every class it wears already ships in both CSS
 * copies (`globals.css` + `apps/desktop-ui/src/styles/kit.css`).
 */

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export function IdentitySearchField({
  value,
  onChange,
  placeholder = "Search identities",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Layout only (width, margins). The face is the kit's. */
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    // `data-open` pinned: this field never collapses, so the pill is its resting state.
    <div className={cn("search-expand", className)} data-open="true">
      <div className="auth-btn-3d-light search-expand-shell">
        <span className="search-expand-toggle" aria-hidden="true">
          <Search size={15} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          className="search-expand-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Escape drops the filter, the same key that closes /home's search card.
            if (event.key !== "Escape") return;
            event.preventDefault();
            onChange("");
            inputRef.current?.blur();
          }}
        />
        {value !== "" && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            className="mr-3 flex h-5 w-5 flex-none items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
