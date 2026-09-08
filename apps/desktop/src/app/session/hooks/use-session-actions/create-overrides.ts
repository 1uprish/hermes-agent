/**
 * Per-create overrides folded onto the params `desktopSessionCreateParams`
 * derived from the visible selection.
 *
 * Kept separate from the hook because the model case is a correctness rule,
 * not a merge: the composer's model and provider are a PAIR, so overriding one
 * without the other mints a session pointing a provider at a model it doesn't
 * serve.
 */
export interface SessionCreateOverrides {
  hidden?: boolean
  model?: { model: string; provider: string; reasoningEffort?: string }
  title?: string
}

export function applySessionCreateOverrides(
  params: Record<string, unknown>,
  overrides: SessionCreateOverrides | undefined
): Record<string, unknown> {
  if (!overrides) {
    return params
  }

  const next = { ...params }

  if (overrides.title) {
    next.title = overrides.title
  }

  if (overrides.hidden) {
    next.hidden = true
  }

  if (overrides.model) {
    next.model = overrides.model.model
    next.provider = overrides.model.provider

    if (overrides.model.reasoningEffort) {
      next.reasoning_effort = overrides.model.reasoningEffort
    }
  }

  return next
}
