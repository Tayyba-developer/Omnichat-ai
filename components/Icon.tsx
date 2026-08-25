export function OutlineIcon({
  d,
  size = 17,
  strokeWidth = 1.7,
}: {
  d: string;
  size?: number;
  strokeWidth?: number;
}) {
  const paths = d.split(" M").map((seg, i) => (i === 0 ? seg : "M" + seg));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {paths.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
