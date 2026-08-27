import { createAuditor } from './auditor'
import type { ScanRunner } from './types'

test('createAuditor needs only a ScanRunner — no browser, no network', async () => {
  const fake: ScanRunner = {
    run: async () => ({
      axe: {
        violations: [
          { id: 'image-alt', impact: 'critical', description: 'Images must have alternate text' },
          { id: 'link-name', impact: 'serious', description: 'Links must have discernible text' },
        ],
        incomplete: [{ id: 'color-contrast', impact: 'serious', description: 'needs review' }],
      },
      textRuns: [],
    }),
  }
  const audit = createAuditor(fake)
  const { issues } = await audit('<img>')

  expect(issues.find((i) => i.id === 'image-alt')?.severity).toBe('blocker')
  expect(issues.find((i) => i.id === 'link-name')?.severity).toBe('error')
  expect(issues.find((i) => i.severity === 'alert')).toBeTruthy()
})

test('a failing contrast run becomes a blocking contrast issue', async () => {
  const fake: ScanRunner = {
    run: async () => ({
      axe: { violations: [] },
      textRuns: [{ fg: '#999999', background: { kind: 'layers', layers: ['#ffffff'] }, size: 'normal' }],
    }),
  }
  const { issues } = await createAuditor(fake)('<p>x</p>')
  const contrast = issues.find((i) => i.category === 'contrast')
  expect(contrast).toBeTruthy()
  expect(contrast!.severity).toBe('blocker')
})

test('an unresolvable background becomes an alert, never a silent pass', async () => {
  const fake: ScanRunner = {
    run: async () => ({
      axe: { violations: [] },
      textRuns: [{ fg: '#000', background: { kind: 'unresolvable', reason: 'conic-gradient' }, size: 'normal' }],
    }),
  }
  const { issues } = await createAuditor(fake)('<p>x</p>')
  expect(issues.some((i) => i.severity === 'alert')).toBe(true)
})
