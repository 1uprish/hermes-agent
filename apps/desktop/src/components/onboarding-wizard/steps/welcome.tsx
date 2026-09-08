import { Blurb } from '@/components/wizard-shell'

// One line each at the card's width — a wrapped bullet reads as two.
const FEATURES: Array<{ head: string; tail: string }> = [
  { head: 'Researches, writes, and builds with', tail: 'real tools' },
  { head: 'Drives a real terminal, browser, and', tail: 'your files' },
  { head: 'Memory and skills that grow', tail: 'across sessions' }
]

export function WelcomeStep() {
  return (
    <div>
      <Blurb>
        Hermes is your personal agent — one mind that lives on your machine and meets you everywhere: desktop,
        terminal, and messages.
      </Blurb>
      <ul className="mb-4 flex flex-col gap-2.5">
        {FEATURES.map(feature => (
          <li className="flex items-baseline gap-2.5 text-[14px] text-muted-foreground" key={feature.tail}>
            <span aria-hidden className="translate-y-[-1px] text-[9px] text-primary">
              ◆
            </span>
            <span>
              {feature.head} <strong className="text-foreground">{feature.tail}</strong>
            </span>
          </li>
        ))}
      </ul>
      <Blurb>Let&apos;s get you set up — it takes about a minute.</Blurb>
    </div>
  )
}
