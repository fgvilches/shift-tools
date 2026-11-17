/**
 * The shift-tools mark: the letter S leaned 9°, drawn on the 256 grid so it stays
 * crisp at every size. Single colour — the accent — because in the sidebar the
 * tile would eat the counters at 26 px.
 */
export function Logo({ size = 26, color = "#0a84ff" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      aria-hidden
      role="presentation"
      focusable="false"
    >
      <g transform="rotate(-9 128 128)">
        <path
          d="M182 64 H104 A32 32 0 0 0 104 128 H152 A32 32 0 0 1 152 192 H74"
          stroke={color}
          strokeWidth={42}
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
