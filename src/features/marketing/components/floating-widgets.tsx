/** Fixed decorative widgets pinned to the viewport corners. */
export function FloatingWidgets() {
  return (
    <>
      <div className="w-finger">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 10a2 2 0 0 1 2 2c0 3-1 5-1 5" />
          <path d="M9 9a4 4 0 0 1 7 3c0 2-.5 4-.5 4" />
          <path d="M6.5 8.5a6 6 0 0 1 10.5 4" />
          <path d="M9.5 19c.5-1 1-2.5 1-4a1.5 1.5 0 0 1 3 0" />
        </svg>
      </div>
      <div className="w-spark">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l1.6 6.4L20 6l-4.4 4.6L22 13l-6.4 1.4L17 21l-5-4-5 4 1.4-6.6L2 13l6.4-2.4L4 6l6.4 2.4z" />
        </svg>
      </div>
    </>
  );
}
