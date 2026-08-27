/**
 * Local, minimal type surface for the render-and-scan auditor.
 *
 * We deliberately model only the subset of axe-core's `AxeResults` that the
 * mapping logic reads. Keeping these structural (rather than importing axe-core's
 * own types) means the pure mapping core + its unit tests never need axe-core or
 * a browser — a real `AxeResults` from `axe.run()` is structurally assignable to
 * `AxeResults` here, and tests can hand-build canned fixtures trivially.
 */
import type { TextSize } from '../../contracts/index';

/** axe-core impact levels (a violation may also carry `null`/absent impact). */
export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** One failing/needs-review DOM node within an axe result (subset). */
export interface AxeNode {
  html?: string;
  target?: ReadonlyArray<string>;
  failureSummary?: string;
}

/** One axe rule result (subset of axe-core's `Result`). */
export interface AxeResult {
  /** axe rule id, e.g. `image-alt`, `color-contrast`. Becomes `AuditIssue.id`. */
  id: string;
  impact?: AxeImpact | null;
  /** Human description; becomes `AuditIssue.message`. */
  description?: string;
  help?: string;
  helpUrl?: string;
  tags?: ReadonlyArray<string>;
  nodes?: ReadonlyArray<AxeNode>;
}

/** Subset of axe-core's top-level `AxeResults`. */
export interface AxeResults {
  /** Definite failures. */
  violations: ReadonlyArray<AxeResult>;
  /** Needs-review / could-not-determine results (→ `alert`). */
  incomplete?: ReadonlyArray<AxeResult>;
  passes?: ReadonlyArray<AxeResult>;
  inapplicable?: ReadonlyArray<AxeResult>;
}

/**
 * One image and its alt text, as found in the rendered DOM.
 *
 * `alt` distinguishes three states that mean different things under WCAG 1.1.1:
 * `null` = no alt attribute at all (axe's `image-alt` error), `''` = an explicit
 * decorative marker (correct), any other string = a text alternative whose
 * *quality* is judged by `altTextIssue`.
 */
export interface ImageAlt {
  alt: string | null;
  src: string;
  /** `role="presentation"` / `role="none"` / `aria-hidden="true"`. */
  presentation: boolean;
}

/**
 * What a single render-and-scan pass yields for the registered checks to map.
 *
 * Fields added here for a NEW check must be OPTIONAL (ADR-0003), so that every
 * existing check and every fake fixture keeps compiling. `images` is optional
 * for exactly that reason rather than being grandfathered in as the one
 * permanent exception — a rule with a single standing exception is one people
 * stop believing.
 */
export interface ScanResult {
  axe: AxeResults;
  textRuns: TextRun[];
  /** Present when the runner extracted images; absent in fixtures that don't need them. */
  images?: ImageAlt[];
}

/**
 * The injected scanner. The implementation this project ships is
 * `createIframeRunner()` (`./iframe-runner.ts`), which renders into a hidden
 * same-origin iframe in the user's OWN browser — there is no Chromium process
 * and no Playwright anywhere in the shipped app. Unit tests inject a fake that
 * returns canned data, so the axe→IssueSet mapping is tested with no browser at
 * all; that is the whole point of keeping this port one method wide.
 */
export interface ScanRunner {
  run(html: string): Promise<ScanResult>;
}

/**
 * A `ScanRunner` that owns a resource — in practice, one hidden iframe, created
 * on the first `run()` and reused across every section of a chapter audit.
 *
 * `ScanRunner` itself deliberately stays a SINGLE method: adding `dispose()` to
 * it would force every injected test fake and `createAuditor` to grow a
 * lifecycle they neither have nor need. Only the concrete factory that actually
 * allocates something returns this wider type, and only the caller who
 * constructed it is obliged to dispose it.
 */
export interface DisposableScanRunner extends ScanRunner {
  /**
   * Release the audit surface. Idempotent, and safe on a runner that never ran.
   *
   * Disposal is FINAL. A `run()` after it rejects rather than allocating a
   * second frame — a stray late scan, one escaping the `finally` that disposed
   * the runner, would otherwise leave a detached audit surface attached to the
   * document. Construct a new runner instead; they are cheap until they run.
   *
   * Disposal is NOT safe against an IN-FLIGHT `run()`, and no caller may assume
   * otherwise: the shipped runner removes its iframe immediately, out from under
   * a scan already using it, so that scan can reject or return meaningless
   * results. The contract is therefore "await `run()`, THEN dispose" — which is
   * exactly what `auditSection`/`compileAndAuditChapter` in `src/engine/index.ts` do,
   * disposing in a `finally` that runs only after the awaited loop.
   */
  dispose(): Promise<void>;
}

/** The resolved background behind a text run, as classified by the runner. */
export type ResolvedBackground =
  | { kind: 'layers'; layers: string[] }       // top→bottom CSS colors down to an opaque base
  | { kind: 'gradient'; css: string }          // raw computed gradient string
  | { kind: 'image'; swatches: string[] }      // worst-case opaque bg samples (rgb strings)
  | { kind: 'unresolvable'; reason: string };  // filters / conic / empty box / screenshot failure

/** One visible text run with its resolved background (replaces TextColorPair). */
export interface TextRun {
  fg: string;
  background: ResolvedBackground;
  size: TextSize;
}
