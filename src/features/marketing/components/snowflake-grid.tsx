/**
 * Decorative snowflake/asterisk grid used as a background flourish on
 * the landing page. Pure presentation — no state, no interactions.
 */
export function SnowflakeGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.06]">
      <div className="grid grid-cols-6 gap-16 p-8">
        {Array.from({ length: 48 }).map((_, i) => (
          <div key={i} className="text-white text-4xl text-center select-none">
            &#10052;
          </div>
        ))}
      </div>
    </div>
  );
}
