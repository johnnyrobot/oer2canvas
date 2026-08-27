/**
 * The deterministic render-and-scan accessibility audit.
 *
 * Public surface for this track. Implements the `Auditor` port from
 * `src/contracts` and is consumed by the output gate (`enforceGate` →
 * `audit(html)` in `src/engine/gate.ts`).
 *
 *  - `createAuditor(runner)`    — the pure mapping core, for DI / testing.
 *
 * This module contains no browser and no network: it maps whatever a
 * `ScanRunner` returns into `AuditIssue`s. The runner that owns an audit surface
 * (`createIframeRunner`, in `./iframe-runner.ts`) is composed in by the caller,
 * not constructed here.
 */
export { createAuditor } from './auditor';
export type { AuditorOptions } from './auditor';
export { CHECKS, axeViolations, axeIncomplete, computedContrast, altTextQuality } from './checks';
export type { Check, CheckOptions } from './checks';
export { severityForImpact, semanticCategory, DEFAULT_VIOLATION_SEVERITY } from './mapping';
export type { IssueCategory } from './mapping';
export type {
  AxeImpact,
  AxeNode,
  AxeResult,
  AxeResults,
  DisposableScanRunner,
  ResolvedBackground,
  ScanResult,
  ScanRunner,
  TextRun,
} from './types';
