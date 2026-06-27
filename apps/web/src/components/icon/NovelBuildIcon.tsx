/**
 * NovelBuild — app logo icon (quill + sparkle).
 *
 * Accepts `size` in px (default 20). Uses `currentColor` for the main
 * nib fill so it adapts to whatever text color it sits next to; the
 * sparkle is always amber-500 regardless of theme.
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
      {/* Quill nib — tapered triangle */}
      <path
        d="M8.5 2.5 25.5 15 18 29.5H12L8.5 2.5Z"
        fill="currentColor"
      />
      {/* Slit line */}
      <path
        d="M12 29 17 17"
        stroke="#fff"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity=".85"
      />
      {/* AI sparkle — four-point star */}
      <path
        d="M26 4 27.5 5.5 29 7 27.5 8.5 26 10 24.5 8.5 23 7 24.5 5.5Z"
        fill="#f59e0b"
        opacity=".95"
      />
    </svg>
  )
}
