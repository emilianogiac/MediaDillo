interface Props {
  label: string
  variant?: 'default' | 'hdr' | 'quality'
}

const QUALITY_COLORS: Record<string, string> = {
  '4K': 'bg-purple-600/80 text-purple-100',
  '1080p': 'bg-blue-600/80 text-blue-100',
  '720p': 'bg-green-700/80 text-green-100',
  SD: 'bg-gray-600/80 text-gray-200',
}

export function TechBadge({ label, variant = 'default' }: Props) {
  const cls =
    variant === 'quality'
      ? (QUALITY_COLORS[label] ?? 'bg-gray-600/80 text-gray-200')
      : variant === 'hdr'
        ? 'bg-yellow-500/80 text-yellow-900 font-bold'
        : 'bg-gray-700 text-gray-300'

  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}
