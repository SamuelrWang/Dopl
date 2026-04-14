/**
 * Text highlight and snippet capture.
 * Injected on-demand when user wants to save a selection.
 */

(function captureSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const text = selection.toString().trim();
  if (!text) return null;

  // Get surrounding context (the parent element's full text)
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const parentEl =
    container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as HTMLElement);

  const context = parentEl?.textContent?.trim().slice(0, 500) || "";

  return {
    selectedText: text,
    context,
    url: window.location.href,
    title: document.title,
  };
})();
