/**
 * Lightweight image placeholder — the static replacement for the original
 * `<image-slot>` omelette custom element (which depended on a `window.omelette`
 * runtime that doesn't exist in the app). Swap for a real <Image> when assets
 * land.
 */
export function ImageSlot({
  shape = "rect",
  placeholder,
}: {
  shape?: "rect" | "circle";
  placeholder?: string;
}) {
  return (
    <div className={shape === "circle" ? "img-slot circle" : "img-slot"}>
      {placeholder}
    </div>
  );
}
