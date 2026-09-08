import { describe, expect, test } from 'vitest'

import { buildPopulatePrompt, parsePopulate, parsePopulateReply, populatedFileContent } from './first-screen-populate'
import { compileFirstScreen } from './onboarding-first-screen'

const CONFIG = compileFirstScreen({ focus: ['Coding', 'Research'], name: 'Karan' }, 'dashboard')

describe('first-screen population', () => {
  test('accepts the screen.json-mirror shape a live run produced (array blocks, nested content)', () => {
    // Live failure 2026-08-25: a perfect 17KB fill in exactly this form was
    // dropped wholesale by the object-only reader — the dashboard never
    // populated. Fences + array-of-blocks + content nested under "content".
    const reply = [
      'Here is the filled screen:',
      '```json',
      JSON.stringify({
        blocks: [
          {
            id: 'start',
            kind: 'action',
            label: 'PR outreach next steps',
            content: { kind: 'action', steps: ['List each investor', 'Draft the quote ask', 'Send by Friday'] }
          },
          {
            id: 'draft',
            kind: 'draft',
            content: { skeleton: 'For [investor], opening line: [metric]. Then [ask].' }
          }
        ],
        extra: [
          {
            id: 'round-facts',
            kind: 'input',
            label: 'Round facts',
            prompt: 'Type the round facts.',
            content: { placeholder: 'e.g. $120M Series B', promptPrefix: 'Fold these facts in: ' }
          }
        ]
      }),
      '```'
    ].join('\n')

    const result = parsePopulate(reply, CONFIG.blocks)

    expect(result.content['start']).toMatchObject({ kind: 'action' })
    expect(result.content['draft']).toMatchObject({ kind: 'draft' })
    expect(result.overrides['start']).toMatchObject({ label: 'PR outreach next steps' })
    expect(result.extra).toHaveLength(1)
    expect(result.extra[0]).toMatchObject({ id: 'round-facts', kind: 'input' })
  })

  test('the two passes split the blocks: fast without feed, feed alone', () => {
    const fast = buildPopulatePrompt(CONFIG, 'fast')
    const feed = buildPopulatePrompt(CONFIG, 'feed')

    for (const block of CONFIG.blocks) {
      const target = block.kind === 'feed' ? feed : fast

      expect(target).toContain(block.id)
    }

    expect(fast).toContain('Do NOT use any tools')
    expect(fast).toContain('ONLY a JSON object')
    expect(feed).toContain('web search')
  })

  test('parses a fenced reply and clamps lengths', () => {
    const long = 'x'.repeat(400)

    const reply = [
      'Here you go:',
      '```json',
      JSON.stringify({
        blocks: {
          brief: {
            items: [
              { line: long, source: 'InfoWorld' },
              { line: 'Short one.', source: 'SD Times' }
            ]
          },
          draft: { skeleton: long },
          start: { steps: ['Do the thing first', long] }
        }
      }),
      '```'
    ].join('\n')

    const content = parsePopulateReply(reply, CONFIG.blocks)

    const brief = content['brief']
    expect(brief?.kind).toBe('feed')

    if (brief?.kind === 'feed') {
      expect(brief.items).toHaveLength(2)
      expect(brief.items[0].line.length).toBeLessThanOrEqual(110)
      expect(brief.items[0].line.endsWith('…')).toBe(true)
    }

    const draft = content['draft']
    expect(draft?.kind).toBe('draft')

    if (draft?.kind === 'draft') {
      expect(draft.skeleton.length).toBeLessThanOrEqual(320)
    }

    const start = content['start']
    expect(start?.kind).toBe('action')

    if (start?.kind === 'action') {
      expect(start.steps[0]).toBe('Do the thing first')
      expect(start.steps[1].length).toBeLessThanOrEqual(90)
    }
  })

  test('partial validity keeps the good blocks and drops the bad', () => {
    const reply = JSON.stringify({
      blocks: {
        brief: { items: [{ line: '', source: '' }] },
        draft: { skeleton: 'Fill [this] in.' },
        start: 'not an object'
      }
    })

    const content = parsePopulateReply(reply, CONFIG.blocks)

    expect(content['brief']).toBeUndefined()
    expect(content['start']).toBeUndefined()
    expect(content['draft']?.kind).toBe('draft')
  })

  test('garbage replies produce an empty map, never a throw', () => {
    expect(parsePopulateReply('no json here', CONFIG.blocks)).toEqual({})
    expect(parsePopulateReply('{broken', CONFIG.blocks)).toEqual({})
    expect(parsePopulateReply('{}', CONFIG.blocks)).toEqual({})
  })

  test('tool example validates on the app kind', () => {
    const appConfig = compileFirstScreen({ focus: ['Writing'], name: '' }, 'app')

    const reply = JSON.stringify({
      blocks: { tool: { example: { input: 'raw paste', output: 'shaped result' } } }
    })

    const content = parsePopulateReply(reply, appConfig.blocks)

    expect(content['tool']?.kind).toBe('tool')
  })

  test('populated file keeps prompts, adds content only where it exists', () => {
    const content = parsePopulateReply(
      JSON.stringify({ blocks: { draft: { skeleton: 'A [x] template.' } } }),
      CONFIG.blocks
    )

    const file = JSON.parse(populatedFileContent(CONFIG, content)) as {
      blocks: { content?: unknown; id: string; prompt: string }[]
      populatedAt: string
      title: string
    }

    expect(file.title).toBe(CONFIG.title)
    expect(file.populatedAt).toBeTruthy()

    for (const block of file.blocks) {
      expect(block.prompt.length).toBeGreaterThan(0)
    }

    expect(file.blocks.find(b => b.id === 'draft')?.content).toBeTruthy()
    expect(file.blocks.find(b => b.id === 'brief')?.content).toBeUndefined()
  })
})
