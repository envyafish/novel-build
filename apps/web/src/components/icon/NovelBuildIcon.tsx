/**
 * NovelBuild — app logo icon (pen nib + sparkle on green badge).
 *
 * `size` in px (default 20). The green background is always present so
 * the icon is legible on any page background.
 */
interface Props {
  size?: number
  className?: string
}

export function NovelBuildIcon({ size = 20, className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Green rounded-rect badge */}
      <rect width="32" height="32" rx="7" fill="#16a34a" />

      {/* Pen nib — tip down, wide shoulder top */}
      <path
        d="M16 27 11 6 13.8 6.5 14.7 18 16 24 17.3 18 18.2 6.5 21 6Z"
        fill="#fff"
      />

      {/* Slit line */}
      <line
        x1="16" y1="9" x2="16" y2="22"
        stroke="#16a34a"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Sparkle cross */}
      <circle cx="26" cy="6" r="1.8" fill="#facc15" />
      <line
        x1="26" y1="2.5" x2="26" y2="9.5"
        stroke="#facc15" strokeWidth="0.9" strokeLinecap="round"
      />
      <line
        x1="22.5" y1="6" x2="29.5" y2="6"
        stroke="#facc15" strokeWidth="0.9" strokeLinecap="round"
      />
    </svg>
  )
}
