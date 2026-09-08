import { EASE } from './tokens'

/** The shell's progress bar: the theme's accent advancing over the surface.
 *  Deliberately not the app's Progress — it spans the card edge-to-edge and
 *  doubles as the frameless window's drag strip. */
export function WizardProgress({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)

  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      className="relative h-1 w-full overflow-hidden bg-background"
      role="progressbar"
    >
      <div
        className="absolute inset-y-0 left-0 bg-primary"
        style={{
          transition: `width 500ms ${EASE}`,
          width: `${pct}%`
        }}
      />
    </div>
  )
}
