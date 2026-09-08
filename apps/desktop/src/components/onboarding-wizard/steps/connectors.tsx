import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { CONNECTORS } from '@/components/onboarding-wizard/options'
import { ConnectorLogo } from '@/components/ui/connector-logo'
import { SearchField } from '@/components/ui/search-field'
import { Blurb, Chip, StepControls } from '@/components/wizard-shell'
import { $wizardAnswers, setWizardAnswers } from '@/store/onboarding-wizard'

export function ConnectorsStep() {
  const answers = useStore($wizardAnswers)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visible = needle ? CONNECTORS.filter(connector => connector.name.toLowerCase().includes(needle)) : CONNECTORS

  const toggle = (id: string) =>
    setWizardAnswers({
      connectors: answers.connectors.includes(id)
        ? answers.connectors.filter(item => item !== id)
        : [...answers.connectors, id]
    })

  return (
    <div>
      <Blurb>
        Hermes can reach the tools you already use. Pick what you&apos;d like connected — setup happens later, in
        Settings, when you&apos;re ready.
      </Blurb>
      <StepControls>
        <SearchField containerClassName="mb-3 w-full" onChange={setQuery} placeholder="Search" value={query} />
        <div className="grid grid-cols-3 gap-2">
          {visible.map(connector => (
            <Chip
              icon={
                <ConnectorLogo
                  className="size-7 rounded-full text-sm"
                  connector={{ homepage: connector.homepage, name: connector.id, title: connector.name }}
                />
              }
              key={connector.id}
              label={connector.name}
              on={answers.connectors.includes(connector.id)}
              onToggle={() => toggle(connector.id)}
            />
          ))}
        </div>
      </StepControls>
    </div>
  )
}
