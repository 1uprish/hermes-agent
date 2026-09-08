import { Switch } from '@/components/ui/switch'

/** Labeled on/off row around the shared Switch. */
export function ToggleRow({
  label,
  on,
  onToggle,
  sub
}: {
  label: string
  on: boolean
  onToggle: () => void
  sub: string
}) {
  return (
    <label className="flex w-full cursor-pointer items-center justify-between gap-6 rounded-[4px] bg-muted px-4 py-3">
      <span>
        <span className="block text-[13px] font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      <Switch checked={on} onCheckedChange={onToggle} />
    </label>
  )
}
