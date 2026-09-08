import { cn } from '@/lib/utils'

/**
 * A percentage bar that assistive technology can read.
 *
 * Six of these were painted as a plain track div wrapping a fill div whose
 * width carried the number, so the value existed only as pixels: a screen
 * reader got the percentage from the label beside it, if there was one, and
 * nothing at all from the bar. The accessibility section of this project's
 * documentation names `role="progressbar"` with the three value attributes as
 * the requirement, and none of the six had it.
 *
 * The role goes on the TRACK, not the fill. The track is what represents the
 * whole range; the fill is the part of it that is done, and announcing that as
 * the progressbar reports a range whose maximum moves.
 *
 * The value is clamped because it arrives from the server. A ratio that
 * overshoots paints past the end of its own track and reports an
 * `aria-valuenow` outside the range it declares.
 */
export function ProgressBar({
  value,
  label,
  trackClassName,
  barClassName,
}: {
  value: number
  label: string
  trackClassName?: string
  barClassName?: string
}) {
  const percent = Math.min(100, Math.max(0, Math.round(value)))

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('w-full overflow-hidden rounded-full bg-surface-container', trackClassName)}
    >
      <div className={cn('h-full rounded-full', barClassName)} style={{ width: `${percent}%` }} />
    </div>
  )
}
