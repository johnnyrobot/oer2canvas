export type Severity = 'blocker' | 'error' | 'warning' | 'advisory' | 'alert'

export interface AuditIssue {
  id: string
  severity: Severity
  message: string
  /** WAVE category for reporting. */
  category?: 'error' | 'contrast' | 'alert' | 'feature' | 'structure' | 'aria'
}

export interface IssueSet {
  issues: AuditIssue[]
}

export interface AllowlistResult {
  /** Repaired, Canvas-safe HTML. */
  html: string
  /** Semantic elements that had to be removed (not merely decorative) — these block. */
  removedSemantic: string[]
}

export interface GateDeps {
  validateAllowlist(html: string): Promise<AllowlistResult>
  audit(html: string): Promise<IssueSet>
}

export interface Conformance {
  passedChecks: boolean
  blockers: AuditIssue[]
  warnings: AuditIssue[]
  needsHumanReview: AuditIssue[]
}

export interface GateResult {
  html: string
  conformance: Conformance
  badgeWithheld: boolean
}

/**
 * Both blocking severities are DEFINITE WCAG failures: `blocker` = axe `critical`
 * (plus contrast and semantic-removal); `error` = axe `serious`, and any violation
 * whose impact axe left unset. Surfacing a serious AA failure as a mere "warning"
 * while still reporting the page as passing would be exactly the overlay-style
 * dishonesty this gate exists to prevent.
 */
const BLOCKING: ReadonlySet<Severity> = new Set<Severity>(['blocker', 'error'])

export async function enforceGate(html: string, deps: GateDeps): Promise<GateResult> {
  const allow = await deps.validateAllowlist(html)
  const { issues } = await deps.audit(allow.html)

  const blockers = issues.filter((i) => BLOCKING.has(i.severity))
  // Removing a semantic element during allowlist repair is itself a blocker.
  // The id is scoped by tag so each removed tag is a DISTINCT issue — a constant
  // id collapses multiple removed tags into one row downstream.
  for (const tag of allow.removedSemantic) {
    blockers.push({
      id: `allowlist-removed-semantic:${tag}`,
      severity: 'blocker',
      message: `Removed semantic <${tag}>`,
    })
  }
  const warnings = issues.filter((i) => i.severity === 'warning')
  const needsHumanReview = issues.filter((i) => i.severity === 'alert' || i.severity === 'advisory')

  const badgeWithheld = blockers.length > 0
  return {
    html: allow.html,
    conformance: { passedChecks: !badgeWithheld, blockers, warnings, needsHumanReview },
    badgeWithheld,
  }
}
