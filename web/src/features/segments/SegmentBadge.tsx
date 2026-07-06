import { useTheme } from '@/shared/theme/useTheme'
import { segmentBadgeStyle } from './segmentColors'

type SegmentBadgeProps = {
  colorKey: string | null | undefined
  className?: string
  children: React.ReactNode
}

export function SegmentBadge({ colorKey, className = '', children }: SegmentBadgeProps) {
  const { theme } = useTheme()
  return (
    <span className={className} style={segmentBadgeStyle(colorKey, theme)}>
      {children}
    </span>
  )
}
