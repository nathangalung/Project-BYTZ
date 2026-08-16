import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatTimerDisplay } from './format'

/**
 * Owns the per-second tick. Kept as a leaf so the surrounding page, which
 * derives several arrays from the time logs, does not re-render every second.
 */
export function TimerDisplay({ running }: { running: boolean }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!running) {
      setSeconds(0)
      return
    }
    const id = setInterval(() => setSeconds((prev) => prev + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  return (
    <p
      className={cn(
        'font-mono text-5xl font-bold tracking-wider',
        running ? 'text-success-600' : 'text-brand-text/30',
      )}
    >
      {formatTimerDisplay(seconds)}
    </p>
  )
}
