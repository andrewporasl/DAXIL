import React from 'react'

type IconName =
  | 'folder-plus'
  | 'window'
  | 'settings'
  | 'play'
  | 'pause'
  | 'skip-back'
  | 'skip-forward'
  | 'mark-in'
  | 'mark-out'
  | 'reset'
  | 'folder'
  | 'video'
  | 'volume-off'
  | 'music'
  | 'image'
  | 'export'
  | 'crop'
  | 'x'

interface Props {
  name: IconName
  size?: number
}

const paths: Record<IconName, React.ReactNode> = {
  'folder-plus': (
    <>
      <path d="M3 7.5h5l1.8 2H21v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 13v5" />
      <path d="M9.5 15.5h5" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 5v4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 12h3" />
      <path d="M11 12h9" />
      <circle cx="9" cy="12" r="2" />
      <path d="M4 17h12" />
      <path d="M20 17h0" />
      <circle cx="18" cy="17" r="2" />
    </>
  ),
  play: <path d="M8 5v14l11-7Z" />,
  pause: (
    <>
      <path d="M8 5v14" />
      <path d="M16 5v14" />
    </>
  ),
  'skip-back': (
    <>
      <path d="M11 7 5 12l6 5V7Z" />
      <path d="M19 7 13 12l6 5V7Z" />
    </>
  ),
  'skip-forward': (
    <>
      <path d="m5 7 6 5-6 5V7Z" />
      <path d="m13 7 6 5-6 5V7Z" />
    </>
  ),
  'mark-in': (
    <>
      <path d="M8 5v14" />
      <path d="M14 8h5" />
      <path d="M14 12h5" />
      <path d="M14 16h5" />
    </>
  ),
  'mark-out': (
    <>
      <path d="M16 5v14" />
      <path d="M5 8h5" />
      <path d="M5 12h5" />
      <path d="M5 16h5" />
    </>
  ),
  reset: (
    <>
      <path d="M5 8a8 8 0 1 1-1 6" />
      <path d="M5 4v4h4" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7.5h5l1.8 2H21v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="m17 10 4-2v8l-4-2" />
    </>
  ),
  'volume-off': (
    <>
      <path d="M4 10v4h4l5 4V6l-5 4Z" />
      <path d="m18 9 3 3-3 3" />
      <path d="m21 9-3 3 3 3" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="m8 14 3-3 6 7" />
      <path d="m14 14 2-2 5 5" />
      <circle cx="8" cy="9" r="1.5" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  crop: (
    <>
      <path d="M6 3v13a2 2 0 0 0 2 2h13" />
      <path d="M3 6h13a2 2 0 0 1 2 2v13" />
      <path d="M10 6v10" />
      <path d="M6 10h10" />
    </>
  ),
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  )
}

export default function Icon({ name, size = 18 }: Props) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}
