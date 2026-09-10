import {
  IconAccessible,
  IconAdjustments,
  IconBell,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconCircleKey,
  IconClock,
  IconDeviceDesktop,
  IconLock,
  IconLockAccess,
  IconMapPin,
  IconMicrophone,
  IconPlugConnected,
  IconRefresh,
  IconRobot,
  IconScreenShare,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconUserCircle
} from '@tabler/icons-react'
import { type ComponentType, type ReactNode, useMemo, useState } from 'react'

import type { MacManPermissionId, MacManPermissionStatus, MacManSnapshot } from './native-contract'

export type { MacManPermissionId, MacManPermissionStatus, MacManSnapshot } from './native-contract'

export type MacManView =
  | 'setup'
  | 'permissions'
  | 'general'
  | 'voice'
  | 'notifications'
  | 'connections'
  | 'privacy'
  | 'advanced'

export type MacManSettingsAction =
  | 'check-updates'
  | 'connect-calendar'
  | 'connect-messages'
  | 'connect-reminders'
  | 'export-data'
  | 'manage-exclusions'
  | 'open-logs'
  | 'reset-data'

type PermissionLevel = 'required' | 'recommended' | 'optional'
type IconType = ComponentType<{ 'aria-hidden'?: boolean; size?: number; stroke?: number }>

type PermissionDefinition = {
  description: string
  icon: IconType
  id: MacManPermissionId
  level: PermissionLevel
  title: string
}

export type MacManAppProps = {
  initialView?: MacManView
  onComplete?: () => void
  onOpenModelSetup?: () => void
  onOpenSystemSettings?: (permission: MacManPermissionId) => void
  onRequestPermission?: (permission: MacManPermissionId) => void
  onRefresh?: () => void
  onSettingsAction?: (action: MacManSettingsAction) => void
  settingsNotice?: string
  snapshot?: MacManSnapshot
}

export const DEFAULT_MACMAN_SNAPSHOT: MacManSnapshot = {
  model: 'not-connected',
  permissions: {
    accessibility: 'not-granted',
    screenRecording: 'not-granted',
    microphone: 'ask-when-used',
    notifications: 'ask-when-used',
    calendar: 'ask-when-used',
    reminders: 'ask-when-used',
    contacts: 'ask-when-used',
    automation: 'per-app',
    fullDiskAccess: 'optional',
    location: 'optional'
  },
  wrapper: 'disconnected'
}

const PERMISSIONS: PermissionDefinition[] = [
  {
    id: 'accessibility',
    title: 'Accessibility',
    description: 'Lets MacMan click, type, and use keyboard shortcuts on your behalf.',
    level: 'required',
    icon: IconAccessible
  },
  {
    id: 'screenRecording',
    title: 'Screen & System Audio Recording',
    description: 'Lets MacMan understand what is visible and hear system audio when a task needs it.',
    level: 'required',
    icon: IconScreenShare
  },
  {
    id: 'microphone',
    title: 'Microphone',
    description: 'Asked only when you start voice input or a voice conversation.',
    level: 'recommended',
    icon: IconMicrophone
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Get notified when work finishes, fails, or needs your approval.',
    level: 'recommended',
    icon: IconBell
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Read or create events only when a calendar task needs it.',
    level: 'recommended',
    icon: IconCalendar
  },
  {
    id: 'reminders',
    title: 'Reminders',
    description: 'Read and create reminders when you ask.',
    level: 'recommended',
    icon: IconClock
  },
  {
    id: 'contacts',
    title: 'Contacts',
    description: 'Resolve people safely before a message, call, or calendar action.',
    level: 'recommended',
    icon: IconUserCircle
  },
  {
    id: 'automation',
    title: 'App Automation',
    description: 'macOS asks separately the first time MacMan controls another app.',
    level: 'recommended',
    icon: IconRobot
  },
  {
    id: 'fullDiskAccess',
    title: 'Full Disk Access',
    description: 'Only needed for local iMessage or unrestricted file access.',
    level: 'optional',
    icon: IconLockAccess
  },
  {
    id: 'location',
    title: 'Location',
    description: 'Useful for local weather, travel time, and nearby recommendations.',
    level: 'optional',
    icon: IconMapPin
  }
]

const NAV_GROUPS: Array<{ label?: string; items: Array<{ icon: IconType; id: MacManView; label: string }> }> = [
  {
    items: [
      { id: 'setup', label: 'Setup', icon: IconSparkles },
      { id: 'permissions', label: 'Permissions', icon: IconShieldCheck }
    ]
  },
  {
    label: 'Settings',
    items: [
      { id: 'general', label: 'General', icon: IconSettings },
      { id: 'voice', label: 'Voice & Audio', icon: IconMicrophone },
      { id: 'notifications', label: 'Notifications', icon: IconBell },
      { id: 'connections', label: 'Connections', icon: IconPlugConnected },
      { id: 'privacy', label: 'Privacy & Safety', icon: IconLock },
      { id: 'advanced', label: 'Advanced', icon: IconAdjustments }
    ]
  }
]

const STATUS_COPY: Record<MacManPermissionStatus, { label: string; tone: string }> = {
  granted: { label: 'Granted', tone: 'positive' },
  'not-granted': { label: 'Needs access', tone: 'attention' },
  'ask-when-used': { label: 'Asked when used', tone: 'neutral' },
  'per-app': { label: 'Per app', tone: 'neutral' },
  optional: { label: 'Not enabled', tone: 'quiet' },
  unavailable: { label: 'Unavailable', tone: 'quiet' }
}

const DIRECT_REQUEST_PERMISSIONS = new Set<MacManPermissionId>([
  'accessibility',
  'screenRecording',
  'microphone',
  'notifications'
])

function MacManMark() {
  return <img alt="" className="mm-brand-logo" src="./macman-mark-transparent.png" />
}

function StatusPill({ status }: { status: MacManPermissionStatus }) {
  const copy = STATUS_COPY[status]

  return <span className={`mm-status mm-status--${copy.tone}`}>{copy.label}</span>
}

function PermissionRow({
  definition,
  onOpenSystemSettings,
  onRequestPermission,
  status
}: {
  definition: PermissionDefinition
  onOpenSystemSettings?: (permission: MacManPermissionId) => void
  onRequestPermission?: (permission: MacManPermissionId) => void
  status: MacManPermissionStatus
}) {
  const Icon = definition.icon

  const canRequest =
    DIRECT_REQUEST_PERMISSIONS.has(definition.id) && (status === 'not-granted' || status === 'ask-when-used')

  const actionLabel = status === 'not-granted' ? `Grant ${definition.title}` : `Set up ${definition.title}`

  return (
    <div className="mm-permission-row">
      <span className="mm-row-icon">
        <Icon aria-hidden size={19} stroke={1.7} />
      </span>
      <span className="mm-row-copy">
        <span className="mm-row-title">{definition.title}</span>
        <span className="mm-row-description">{definition.description}</span>
      </span>
      <span className="mm-row-actions">
        <StatusPill status={status} />
        {canRequest ? (
          <button
            aria-label={actionLabel}
            className="mm-button mm-button--small"
            onClick={() => onRequestPermission?.(definition.id)}
            type="button"
          >
            {status === 'not-granted' ? 'Grant access' : 'Set up'}
          </button>
        ) : (
          <button
            aria-label={`Open ${definition.title} settings`}
            className="mm-button mm-button--small mm-button--quiet"
            onClick={() => onOpenSystemSettings?.(definition.id)}
            type="button"
          >
            Open Settings
          </button>
        )}
      </span>
    </div>
  )
}

function PermissionGroup({
  description,
  level,
  onOpenSystemSettings,
  onRequestPermission,
  snapshot,
  title
}: {
  description: string
  level: PermissionLevel
  onOpenSystemSettings?: (permission: MacManPermissionId) => void
  onRequestPermission?: (permission: MacManPermissionId) => void
  snapshot: MacManSnapshot
  title: string
}) {
  return (
    <section aria-labelledby={`permission-${level}`} className="mm-section">
      <div className="mm-section-heading">
        <div>
          <h2 id={`permission-${level}`}>{title}</h2>
          <p>{description}</p>
        </div>
        <span className={`mm-level mm-level--${level}`}>{level}</span>
      </div>
      <div className="mm-list">
        {PERMISSIONS.filter(permission => permission.level === level).map(permission => (
          <PermissionRow
            definition={permission}
            key={permission.id}
            onOpenSystemSettings={onOpenSystemSettings}
            onRequestPermission={onRequestPermission}
            status={snapshot.permissions[permission.id]}
          />
        ))}
      </div>
    </section>
  )
}

function SetupView({
  onComplete,
  onOpenModelSetup,
  onOpenSystemSettings,
  onRequestPermission,
  onViewPermissions,
  snapshot
}: MacManAppProps & { onViewPermissions: () => void; snapshot: MacManSnapshot }) {
  const requiredReady =
    snapshot.permissions.accessibility === 'granted' && snapshot.permissions.screenRecording === 'granted'

  const readyCount = Number(snapshot.permissions.accessibility === 'granted') + Number(snapshot.permissions.screenRecording === 'granted')

  return (
    <div className="mm-page mm-page--setup">
      <header className="mm-page-header">
        <span className="mm-eyebrow">WELCOME TO MACMAN</span>
        <h1>Set up MacMan</h1>
        <p>Choose what MacMan can do on this Mac. Required access is kept separate from permissions you can add later.</p>
      </header>

      <section aria-label="Setup readiness" className="mm-readiness">
        <div className="mm-readiness-main">
          <span className={`mm-readiness-icon ${requiredReady ? 'is-ready' : ''}`}>
            {requiredReady ? <IconCheck aria-hidden size={22} stroke={2.2} /> : <IconDeviceDesktop aria-hidden size={22} stroke={1.8} />}
          </span>
          <div>
            <h2>{requiredReady ? 'Computer control ready' : `${readyCount} of 2 ready`}</h2>
            <p>
              {requiredReady
                ? 'MacMan has the two macOS permissions needed to see and operate this Mac.'
                : 'Accessibility and Screen Recording are both required for reliable computer control.'}
            </p>
          </div>
        </div>
        <button className="mm-button mm-button--quiet" onClick={onViewPermissions} type="button">
          View all <IconChevronRight aria-hidden size={16} stroke={1.8} />
        </button>
      </section>

      <section aria-labelledby="model-heading" className="mm-section">
        <div className="mm-section-heading">
          <div>
            <h2 id="model-heading">Intelligence</h2>
            <p>Your model connection is separate from macOS access.</p>
          </div>
        </div>
        <div className="mm-list">
          <div className="mm-permission-row">
            <span className="mm-row-icon">
              <IconCircleKey aria-hidden size={19} stroke={1.7} />
            </span>
            <span className="mm-row-copy">
              <span className="mm-row-title">Model connection</span>
              <span className="mm-row-description">Choose a hosted or local model through the MacMan wrapper.</span>
              {snapshot.modelName ? (
                <span className="mm-row-description">{snapshot.modelProvider} · {snapshot.modelName}</span>
              ) : null}
            </span>
            <span className="mm-row-actions">
              <span className={`mm-status mm-status--${snapshot.model === 'connected' ? 'positive' : 'attention'}`}>
                {snapshot.model === 'connected' ? 'Connected' : snapshot.model === 'checking' ? 'Checking' : 'Not connected'}
              </span>
              <button className="mm-button mm-button--small" onClick={onOpenModelSetup} type="button">
                {snapshot.model === 'connected' ? 'Change model' : 'Connect model'}
              </button>
            </span>
          </div>
        </div>
      </section>

      <PermissionGroup
        description="Needed only when you want MacMan to operate apps for you."
        level="required"
        onOpenSystemSettings={onOpenSystemSettings}
        onRequestPermission={onRequestPermission}
        snapshot={snapshot}
        title="Required for computer control"
      />

      <PermissionGroup
        description="macOS asks at the moment a feature first needs access."
        level="recommended"
        onOpenSystemSettings={onOpenSystemSettings}
        onRequestPermission={onRequestPermission}
        snapshot={snapshot}
        title="Recommended as you use MacMan"
      />

      <PermissionGroup
        description="Leave these off unless a specific workflow needs them."
        level="optional"
        onOpenSystemSettings={onOpenSystemSettings}
        onRequestPermission={onRequestPermission}
        snapshot={snapshot}
        title="Optional capabilities"
      />

      <div className="mm-setup-footer">
        <p>You can change every permission later in Permissions.</p>
        <div className="mm-footer-actions">
          {!requiredReady ? (
            <button className="mm-button mm-button--quiet" onClick={onComplete} type="button">
              Continue with chat only
            </button>
          ) : null}
          <button className="mm-button mm-button--primary" onClick={onComplete} type="button">
            {requiredReady ? 'Finish setup' : 'Finish later'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PermissionsView({
  onOpenSystemSettings,
  onRefresh,
  onRequestPermission,
  snapshot
}: MacManAppProps & { snapshot: MacManSnapshot }) {
  const granted = Object.values(snapshot.permissions).filter(status => status === 'granted').length

  return (
    <div className="mm-page">
      <header className="mm-page-header mm-page-header--with-action">
        <div>
          <span className="mm-eyebrow">SYSTEM ACCESS</span>
          <h1>Permissions</h1>
          <p>See what MacMan can access, why it is needed, and whether macOS has granted it.</p>
        </div>
        <button className="mm-button mm-button--quiet" onClick={onRefresh} type="button">
          <IconRefresh aria-hidden size={16} stroke={1.8} /> Refresh status
        </button>
      </header>
      <div className="mm-permission-summary">
        <strong>{granted}</strong>
        <span>permissions granted</span>
        <span className="mm-summary-note">Status must come from the MacMan wrapper.</span>
      </div>
      <PermissionGroup
        description="Both permissions are necessary for computer control. Chat works without them."
        level="required"
        onOpenSystemSettings={onOpenSystemSettings}
        onRequestPermission={onRequestPermission}
        snapshot={snapshot}
        title="Computer control"
      />
      <PermissionGroup
        description="Requested in context, so MacMan never asks for access before you use the feature."
        level="recommended"
        onOpenSystemSettings={onOpenSystemSettings}
        onRequestPermission={onRequestPermission}
        snapshot={snapshot}
        title="Feature access"
      />
      <PermissionGroup
        description="Power-user access that should stay disabled until a workflow clearly needs it."
        level="optional"
        onOpenSystemSettings={onOpenSystemSettings}
        onRequestPermission={onRequestPermission}
        snapshot={snapshot}
        title="Optional access"
      />
    </div>
  )
}

function Toggle({ defaultChecked = false, label }: { defaultChecked?: boolean; label: string }) {
  const storageKey = `macman:setting:${label.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`

  const [checked, setChecked] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)

      return stored === null ? defaultChecked : stored === '1'
    } catch {
      return defaultChecked
    }
  })

  function toggle() {
    setChecked(current => {
      const next = !current

      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        // The control remains usable when storage is unavailable.
      }

      return next
    })
  }

  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`mm-switch ${checked ? 'is-on' : ''}`}
      onClick={toggle}
      role="switch"
      type="button"
    >
      <span />
    </button>
  )
}

function SettingRow({ action, description, title }: { action: ReactNode; description: string; title: string }) {
  return (
    <div className="mm-setting-row">
      <div>
        <span className="mm-row-title">{title}</span>
        <span className="mm-row-description">{description}</span>
      </div>
      <div className="mm-setting-action">{action}</div>
    </div>
  )
}

function SettingsPage({
  notice,
  onSettingsAction,
  view,
  wrapperStatus
}: {
  notice?: string
  onSettingsAction?: (action: MacManSettingsAction) => void
  view: Exclude<MacManView, 'setup' | 'permissions'>
  wrapperStatus: NonNullable<MacManSnapshot['wrapper']>
}) {
  if (view === 'general') {
    return (
      <SettingsScaffold description="Choose how MacMan starts, looks, and stays available." notice={notice} title="General">
        <SettingsGroup title="Startup">
          <SettingRow action={<Toggle defaultChecked label="Launch MacMan at login" />} description="Start quietly after you sign in to this Mac." title="Launch MacMan at login" />
          <SettingRow action={<Toggle defaultChecked label="Menu bar access" />} description="Keep quick actions and status in the macOS menu bar." title="Menu bar access" />
          <SettingRow action={<Select label="When closing the window" options={['Keep running', 'Quit MacMan']} value="Keep running" />} description="Keep working when the main window is closed." title="When closing the window" />
        </SettingsGroup>
        <SettingsGroup title="Appearance & input">
          <SettingRow action={<Select label="Appearance" options={['System', 'Dark', 'Light']} value="System" />} description="Follow macOS, or choose light or dark." title="Appearance" />
          <SettingRow action={<Select label="Language" options={['English']} value="English" />} description="Language used throughout MacMan." title="Language" />
          <SettingRow action={<Keycap keys="⌥ Space" />} description="Open MacMan from anywhere." title="Global shortcut" />
        </SettingsGroup>
        <SettingsGroup title="Updates">
          <SettingRow action={<Toggle defaultChecked label="Automatic updates" />} description="Download trusted updates and install them when MacMan restarts." title="Automatic updates" />
          <SettingRow action={<button className="mm-button mm-button--small" onClick={() => onSettingsAction?.('check-updates')} type="button">Check now</button>} description="MacMan 0.21.1 · Stable channel" title="Software update" />
        </SettingsGroup>
      </SettingsScaffold>
    )
  }

  if (view === 'voice') {
    return (
      <SettingsScaffold description="Control when MacMan listens, speaks, and can be interrupted." notice={notice} title="Voice & Audio">
        <SettingsGroup title="Input">
          <SettingRow action={<Select label="Microphone" options={['System default']} value="System default" />} description="The microphone used for voice conversations." title="Microphone" />
          <SettingRow action={<Keycap keys="Hold ⌥" />} description="Talk only while the shortcut is held." title="Push to talk" />
          <SettingRow action={<Toggle label="Wake phrase" />} description="Listen locally for “Hey MacMan” while enabled." title="Wake phrase" />
        </SettingsGroup>
        <SettingsGroup title="Output">
          <SettingRow action={<Select label="Speaker" options={['System default']} value="System default" />} description="Where spoken responses play." title="Speaker" />
          <SettingRow action={<Select label="Voice" options={['Natural']} value="Natural" />} description="Choose the speaking voice and preview it." title="Voice" />
          <SettingRow action={<Toggle defaultChecked label="Allow interruption" />} description="Stop speaking as soon as you start talking." title="Allow interruption" />
        </SettingsGroup>
      </SettingsScaffold>
    )
  }

  if (view === 'notifications') {
    return (
      <SettingsScaffold description="Decide when MacMan should get your attention." notice={notice} title="Notifications">
        <SettingsGroup title="Notify me when">
          <SettingRow action={<Toggle defaultChecked label="A task finishes" />} description="Show a notification for completed background work." title="A task finishes" />
          <SettingRow action={<Toggle defaultChecked label="Approval is needed" />} description="Always surface actions waiting for your decision." title="Approval is needed" />
          <SettingRow action={<Toggle defaultChecked label="A task fails" />} description="Show the error and a clear route back to the task." title="A task fails" />
        </SettingsGroup>
        <SettingsGroup title="Behavior">
          <SettingRow action={<Toggle defaultChecked label="Play sounds" />} description="Use restrained sounds for approvals and completed work." title="Play sounds" />
          <SettingRow action={<Toggle defaultChecked label="Respect Focus" />} description="Let macOS Focus modes silence non-critical notifications." title="Respect Focus" />
        </SettingsGroup>
      </SettingsScaffold>
    )
  }

  if (view === 'connections') {
    return (
      <SettingsScaffold description="Connect the apps and accounts MacMan can work with." notice={notice} title="Connections">
        <SettingsGroup title="Apple apps">
          <ConnectionRow action="connect-messages" description="Send and read messages on this Mac. Requires Full Disk Access." name="Messages" onAction={onSettingsAction} status="Set up" />
          <ConnectionRow action="connect-calendar" description="Create events and check availability." name="Calendar" onAction={onSettingsAction} status="Set up" />
          <ConnectionRow action="connect-reminders" description="Create and complete reminders." name="Reminders" onAction={onSettingsAction} status="Set up" />
        </SettingsGroup>
        <SettingsGroup title="Web & accounts">
          <ConnectionRow description="Use your signed-in browser for approved tasks." name="Browser" status="Available in chat" />
          <ConnectionRow description="Connect an email account when the MacMan chat surface is enabled." name="Email" status="Available in chat" />
          <ConnectionRow description="Add supported tools from the MacMan chat surface." name="More connections" status="Available in chat" />
        </SettingsGroup>
      </SettingsScaffold>
    )
  }

  if (view === 'privacy') {
    return (
      <SettingsScaffold description="Set clear limits on what MacMan may do and remember." notice={notice} title="Privacy & Safety">
        <SettingsGroup title="Action safety">
          <SettingRow action={<Select label="Approval level" options={['Ask for sensitive actions', 'Ask for every action']} value="Ask for sensitive actions" />} description="Always confirm messages, purchases, deletions, account changes, and terminal commands." title="Approval level" />
          <SettingRow action={<Toggle defaultChecked label="Confirm destructive actions" />} description="Require a second confirmation before irreversible changes." title="Confirm destructive actions" />
          <SettingRow action={<button aria-label="Manage exclusions" className="mm-button mm-button--small" onClick={() => onSettingsAction?.('manage-exclusions')} type="button">Manage</button>} description="Apps and locations MacMan must never inspect or control." title="Excluded apps and folders" />
        </SettingsGroup>
        <SettingsGroup title="Data">
          <SettingRow action={<Select label="Activity history" options={['7 days', '30 days', '90 days', 'Forever']} value="30 days" />} description="How long local task history and diagnostic context are retained." title="Activity history" />
          <SettingRow action={<Toggle defaultChecked label="Redact sensitive fields" />} description="Hide password fields and likely secrets from screenshots." title="Redact sensitive fields" />
          <SettingRow action={<Toggle label="Share diagnostics" />} description="Send crash data only; task content stays excluded." title="Share diagnostics" />
        </SettingsGroup>
      </SettingsScaffold>
    )
  }

  return (
    <SettingsScaffold description="Runtime visibility and maintenance controls for advanced users." notice={notice} title="Advanced">
      <SettingsGroup title="Runtime">
        <SettingRow
          action={
            <span className={`mm-inline-ready ${wrapperStatus === 'connected' ? '' : 'is-offline'}`}>
              <span />
              {wrapperStatus === 'connected' ? 'Connected' : wrapperStatus === 'checking' ? 'Checking' : 'Not connected'}
            </span>
          }
          description="The wrapper reports whether MacMan can accept new work."
          title="Runtime health"
        />
        <SettingRow action={<button className="mm-button mm-button--small" onClick={() => onSettingsAction?.('open-logs')} type="button">Open logs</button>} description="Review local logs with secrets redacted." title="Diagnostic logs" />
        <SettingRow action={<Toggle label="Developer mode" />} description="Show detailed tool activity and experimental controls." title="Developer mode" />
      </SettingsGroup>
      <SettingsGroup title="Data & recovery">
        <SettingRow action={<button aria-label="Export MacMan data" className="mm-button mm-button--small" onClick={() => onSettingsAction?.('export-data')} type="button">Export</button>} description="Save MacMan settings and non-secret connection metadata." title="Export MacMan data" />
        <SettingRow action={<button aria-label="Reset MacMan data" className="mm-button mm-button--small mm-button--danger" onClick={() => onSettingsAction?.('reset-data')} type="button">Reset</button>} description="Remove local MacMan settings and return to this setup screen." title="Reset MacMan" />
      </SettingsGroup>
    </SettingsScaffold>
  )
}

function SettingsScaffold({ children, description, notice, title }: { children: ReactNode; description: string; notice?: string; title: string }) {
  return (
    <div className="mm-page mm-page--settings">
      <header className="mm-page-header">
        <span className="mm-eyebrow">SETTINGS</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {notice ? <div className="mm-settings-notice" role="status">{notice}</div> : null}
      {children}
    </div>
  )
}

function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="mm-section mm-settings-section">
      <div className="mm-section-heading">
        <h2>{title}</h2>
      </div>
      <div className="mm-list">{children}</div>
    </section>
  )
}

function Select({ label, options, value }: { label: string; options: string[]; value: string }) {
  const storageKey = `macman:setting:${label.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`

  const [selected, setSelected] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)

      return stored && options.includes(stored) ? stored : value
    } catch {
      return value
    }
  })

  return (
    <select
      aria-label={label}
      className="mm-select"
      onChange={event => {
        const next = event.currentTarget.value

        setSelected(next)

        try {
          window.localStorage.setItem(storageKey, next)
        } catch {
          // The selection remains usable when storage is unavailable.
        }
      }}
      value={selected}
    >
      {options.map(option => <option key={option}>{option}</option>)}
    </select>
  )
}

function Keycap({ keys }: { keys: string }) {
  return <span className="mm-keycap">{keys}</span>
}

function ConnectionRow({
  action,
  description,
  name,
  onAction,
  status
}: {
  action?: MacManSettingsAction
  description: string
  name: string
  onAction?: (action: MacManSettingsAction) => void
  status: string
}) {
  return (
    <SettingRow
      action={
        action ? (
          <button
            aria-label={`Set up ${name}`}
            className="mm-button mm-button--small mm-button--quiet"
            onClick={() => onAction?.(action)}
            type="button"
          >
            {status}
          </button>
        ) : <span className="mm-connection-note">{status}</span>
      }
      description={description}
      title={name}
    />
  )
}

export function MacManApp({
  initialView = 'setup',
  onComplete,
  onOpenModelSetup,
  onOpenSystemSettings,
  onRequestPermission,
  onRefresh,
  onSettingsAction,
  settingsNotice,
  snapshot = DEFAULT_MACMAN_SNAPSHOT
}: MacManAppProps) {
  const [activeView, setActiveView] = useState<MacManView>(initialView)
  const wrapperStatus = snapshot.wrapper

  const completeSetup = () => {
    onComplete?.()
    setActiveView('general')
  }

  const activeLabel = useMemo(
    () => NAV_GROUPS.flatMap(group => group.items).find(item => item.id === activeView)?.label ?? 'MacMan',
    [activeView]
  )

  return (
    <div className="mm-app">
      <div aria-hidden="true" className="mm-titlebar">
        <span />
      </div>
      <aside className="mm-sidebar">
        <div className="mm-brand">
          <MacManMark />
          <div>
            <strong>MacMan</strong>
            <span>Personal assistant</span>
          </div>
        </div>
        <nav aria-label="MacMan navigation">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div className="mm-nav-group" key={group.label ?? groupIndex}>
              {group.label ? <span className="mm-nav-label">{group.label}</span> : null}
              {group.items.map(item => {
                const Icon = item.icon

                return (
                  <button
                    aria-current={activeView === item.id ? 'page' : undefined}
                    className={`mm-nav-item ${activeView === item.id ? 'is-active' : ''}`}
                    key={item.id}
                    onClick={() => setActiveView(item.id)}
                    type="button"
                  >
                    <Icon aria-hidden size={18} stroke={1.7} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="mm-sidebar-footer">
          <span className={`mm-runtime-dot ${wrapperStatus === 'connected' ? 'is-connected' : ''}`} />
          <span>
            {wrapperStatus === 'connected'
              ? 'Wrapper connected'
              : wrapperStatus === 'checking'
                ? 'Checking wrapper'
                : 'Wrapper not connected'}
          </span>
        </div>
      </aside>
      <main aria-label={activeLabel} className="mm-main">
        {activeView === 'setup' ? (
          <SetupView
            onComplete={completeSetup}
            onOpenModelSetup={onOpenModelSetup}
            onOpenSystemSettings={onOpenSystemSettings}
            onRequestPermission={onRequestPermission}
            onViewPermissions={() => setActiveView('permissions')}
            snapshot={snapshot}
          />
        ) : activeView === 'permissions' ? (
          <PermissionsView
            onOpenSystemSettings={onOpenSystemSettings}
            onRefresh={onRefresh}
            onRequestPermission={onRequestPermission}
            snapshot={snapshot}
          />
        ) : (
          <SettingsPage
            notice={settingsNotice}
            onSettingsAction={onSettingsAction}
            view={activeView}
            wrapperStatus={wrapperStatus}
          />
        )}
      </main>
    </div>
  )
}
