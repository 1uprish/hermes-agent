import { useEffect, useRef, useState } from 'react'

const MARK_SRC = './macman-mark-transparent.png'
const MARK_SIZE = 30
const SAMPLE_SIZE = 48
const MAX_POINTS = 180
const CYCLE_SECONDS = 7.2

interface MarkPoint {
  x: number
  y: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smootherStep(value: number): number {
  const x = clamp01(value)

  return x * x * x * (x * (x * 6 - 15) + 10)
}

function hashPoint(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453

  return value - Math.floor(value)
}

function thinkingMorphAt(seconds: number): number {
  const local = seconds % CYCLE_SECONDS

  if (local < 0.45) return 1
  if (local < 1.65) return 1 - smootherStep((local - 0.45) / 1.2)
  if (local < 4.6) return 0
  if (local < 5.9) return smootherStep((local - 4.6) / 1.3)

  return 1
}

function sampleMark(image: HTMLImageElement): MarkPoint[] {
  const source = document.createElement('canvas')
  source.width = SAMPLE_SIZE
  source.height = SAMPLE_SIZE

  const context = source.getContext('2d', { willReadFrequently: true })

  if (!context) return []

  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

  const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const toneAt = (x: number, y: number) => {
    const offset = (y * SAMPLE_SIZE + x) * 4
    const alpha = data[offset + 3] / 255
    const luminance = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255

    return alpha * (0.28 + luminance * 0.72)
  }

  const candidates: Array<MarkPoint & { order: number }> = []

  for (let y = 1; y < SAMPLE_SIZE - 1; y += 1) {
    for (let x = 1; x < SAMPLE_SIZE - 1; x += 1) {
      const center = toneAt(x, y)
      const edge = Math.max(
        Math.abs(center - toneAt(x - 1, y)),
        Math.abs(center - toneAt(x + 1, y)),
        Math.abs(center - toneAt(x, y - 1)),
        Math.abs(center - toneAt(x, y + 1))
      )

      if (edge > 0.1) {
        candidates.push({
          order: hashPoint(x, y),
          x: (x + 0.5) / SAMPLE_SIZE,
          y: (y + 0.5) / SAMPLE_SIZE
        })
      }
    }
  }

  return candidates
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_POINTS)
    .map(({ x, y }) => ({ x, y }))
}

function paintFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  points: MarkPoint[],
  seconds: number,
  color: string
): void {
  const morph = thinkingMorphAt(seconds)
  const crisp = smootherStep((morph - 0.82) / 0.18)
  const center = MARK_SIZE / 2
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  context.clearRect(0, 0, MARK_SIZE, MARK_SIZE)
  context.fillStyle = color

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const sphereY = 1 - (2 * (index + 0.5)) / points.length
    const sphereRadius = Math.sqrt(1 - sphereY * sphereY)
    const angle = index * goldenAngle + seconds * 0.62
    const sphereX = Math.cos(angle) * sphereRadius
    const sphereZ = Math.sin(angle) * sphereRadius
    const orbX = center + sphereX * MARK_SIZE * 0.34
    const orbY = center + (sphereY * 0.76 + sphereZ * 0.16) * MARK_SIZE * 0.34
    const logoX = MARK_SIZE * (0.06 + point.x * 0.88)
    const logoY = MARK_SIZE * (0.06 + point.y * 0.88)
    const x = orbX + (logoX - orbX) * morph
    const y = orbY + (logoY - orbY) * morph
    const depth = (sphereZ + 1) / 2
    const radius = 0.45 + depth * 0.42 + morph * 0.08

    context.globalAlpha = (0.34 + depth * 0.58) * (1 - crisp)
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }

  if (crisp > 0) {
    context.globalAlpha = crisp
    context.drawImage(image, MARK_SIZE * 0.03, MARK_SIZE * 0.03, MARK_SIZE * 0.94, MARK_SIZE * 0.94)
  }

  context.globalAlpha = 1
}

export function MacManThinkingMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasReady, setCanvasReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) return

    const reduceMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion) return

    const image = new Image()
    let animationFrame = 0
    let disposed = false
    let visible = true
    let cleanupVisibility: (() => void) | undefined
    const startedAt = performance.now()

    image.decoding = 'async'
    image.onload = () => {
      if (disposed) return

      const context = canvas.getContext('2d')
      const points = sampleMark(image)

      if (!context || points.length === 0) return

      const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(MARK_SIZE * pixelRatio)
      canvas.height = Math.round(MARK_SIZE * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

      const color = getComputedStyle(canvas).color
      const render = (now: number) => {
        paintFrame(context, image, points, (now - startedAt) / 1000, color)

        if (!disposed && visible && document.visibilityState !== 'hidden') {
          animationFrame = requestAnimationFrame(render)
        }
      }
      const start = () => {
        cancelAnimationFrame(animationFrame)
        animationFrame = requestAnimationFrame(render)
      }

      paintFrame(context, image, points, 0, color)
      setCanvasReady(true)
      start()

      const visibilityObserver =
        typeof IntersectionObserver === 'undefined'
          ? undefined
          : new IntersectionObserver(([entry]) => {
              visible = entry.isIntersecting

              if (visible && document.visibilityState !== 'hidden') start()
              else cancelAnimationFrame(animationFrame)
            })

      visibilityObserver?.observe(canvas)

      const handleDocumentVisibility = () => {
        if (document.visibilityState === 'hidden') cancelAnimationFrame(animationFrame)
        else if (visible) start()
      }

      document.addEventListener('visibilitychange', handleDocumentVisibility)

      cleanupVisibility = () => {
        visibilityObserver?.disconnect()
        document.removeEventListener('visibilitychange', handleDocumentVisibility)
      }
    }
    image.src = MARK_SRC

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      cleanupVisibility?.()
    }
  }, [])

  return (
    <div aria-label="MacMan is thinking" className={`mm-chat-thinking${canvasReady ? ' is-ready' : ''}`} role="status">
      <img alt="" aria-hidden src={MARK_SRC} />
      <canvas aria-hidden ref={canvasRef} />
    </div>
  )
}
