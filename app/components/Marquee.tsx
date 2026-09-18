const ITEMS = ["Solana", "Pyth Network", "Anchor", "Token-2022"];

export function Marquee() {
  // Duplicated once so the CSS animation (translateX -50%) loops seamlessly.
  const items = [...ITEMS, ...ITEMS];
  return (
    <div className="marquee">
      <div className="marquee-track">
        {items.map((name, i) => (
          <span className="marquee-item" key={`${name}-${i}`}>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
