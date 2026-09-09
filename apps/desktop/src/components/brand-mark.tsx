import { cn } from '@/lib/utils'
import { IS_MACMAN_DISTRIBUTION } from '@/product-brand'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Distribution-aware brand badge. MacMan uses the same squircle as the Dock;
// the upstream app keeps its existing Nous tile.
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden',
        IS_MACMAN_DISTRIBUTION ? 'bg-transparent' : 'rounded-md bg-white',
        className
      )}
      {...props}
    >
      <img
        alt=""
        className="size-full object-contain"
        src={assetPath(IS_MACMAN_DISTRIBUTION ? 'apple-touch-icon.png' : 'nous-girl.jpg')}
      />
    </span>
  )
}
