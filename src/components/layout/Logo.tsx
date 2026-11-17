export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden role="presentation">
      <defs>
        <linearGradient id="st-mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5aa8ff" />
          <stop offset="0.55" stopColor="#0a84ff" />
          <stop offset="1" stopColor="#0055b3" />
        </linearGradient>
        <linearGradient id="st-gloss" x1="16" y1="1" x2="16" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="url(#st-mark)" />
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="url(#st-gloss)" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="#ffffff" strokeOpacity="0.28" />
      {/* Stylized shift arrow: a bolt made of two offset strokes */}
      <path d="M11 10.5h9.2l-3.4 4.6h4.2L12.4 23l2.1-5.6h-4.3l3.4-4.6H11z" fill="#ffffff" fillOpacity="0.96" />
      <path d="M20.6 10.5 17.2 15h3.6" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
