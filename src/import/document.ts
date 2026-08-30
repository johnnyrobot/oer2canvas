import type { ImportFinding, ImportMetadata, ImportResult } from './types'
import type { ParserProbeProgress } from './parsers/probe'
import { DOCUMENT_IMPORT_LIMITS } from './limits'
import { documentIds, importProvenance, sha256Hex, validateImportMetadata } from './common'
import {
  ENABLED_ANYDOC_CAPABILITIES,
  capabilityForFilename,
  type DocumentFormatCapability,
} from './capability'
import { readPresentationIndex } from './presentation/index'
import { reconcilePresentation } from './presentation/reconcile'

export interface StructuredDocumentImportOptions {
  metadata: ImportMetadata
  signal?: AbortSignal
  onProgress?: (progress: ParserProbeProgress) => void
}

function enabledCapabilityFor(file: File): DocumentFormatCapability {
  const capability = capabilityForFilename(file.name)
  if (!capability || capability.status !== 'enabled' || capability.parser !== 'anydoc') {
    const extensions = ENABLED_ANYDOC_CAPABILITIES.flatMap((entry) => entry.extensions).join(', ')
    throw new Error(`Choose a supported document file (${extensions}).`)
  }
  return capability
}

export async function importStructuredDocument(
  file: File,
  options: StructuredDocumentImportOptions,
): Promise<ImportResult> {
  options.signal?.throwIfAborted()
  validateImportMetadata(options.metadata)
  const capability = enabledCapabilityFor(file)
  if (file.size > DOCUMENT_IMPORT_LIMITS.maximumInputBytes) {
    throw new Error(`This ${capability.label} exceeds the 16 MiB browser limit.`)
  }

  const bytes = await file.arrayBuffer()
  options.signal?.throwIfAborted()
  const sourceSha256 = await sha256Hex(bytes)
  options.signal?.throwIfAborted()
  const { probeParser } = await import('./parsers/probe')
  options.signal?.throwIfAborted()
  const parsed = await probeParser({
    parser: 'anydoc',
    bytes,
    formatHint: capability.format,
    signal: options.signal,
    onProgress: options.onProgress,
  })
  if (parsed.formatDetection !== 'content' || parsed.detectedFormat !== capability.format) {
    const detected = parsed.formatDetection === 'content'
      ? parsed.detectedFormat.toUpperCase()
      : 'not recognized'
    const article = /^[aeiou]/i.test(capability.format) ? 'an' : 'a'
    throw new Error(
      `The file contents are ${detected}, not ${article} ${capability.format.toUpperCase()} document.`,
    )
  }
  if (!parsed.normalized) throw new Error('AnyDoc returned no normalized document content.')

  // A presentation's normalized HTML is anydoc's account only. Reconciling it
  // against the deck's own index is what turns it into sections a reader can
  // trust — and what refuses the file when the two accounts disagree.
  let html = parsed.normalized.html
  const presentationFindings: ImportFinding[] = []
  if (capability.format === 'pptx' || capability.format === 'odp') {
    // DEFENSE IN DEPTH, not a live path: the format-detection guard above
    // (`parsed.detectedFormat === capability.format`) already ensures
    // `capability.format` here is exactly what the Worker detected, and the
    // Worker (`workers/anydoc.worker.ts`) sets `presentation` for every
    // format `isPresentationPackageKind` accepts — currently 'pptx' and
    // 'odp', the same two checked above — so this cannot fire today. It stays
    // because that Worker-side coupling lives in a different file and could
    // silently drift; if it ever does, refusing beats reconciling against an
    // index this branch has no way to build.
    if (!parsed.presentation) {
      throw new Error(
        `This ${capability.label} could not be read as a package, so its slides cannot be identified.`,
      )
    }
    const index = readPresentationIndex(parsed.presentation.kind, parsed.presentation.parts)
    const reconciled = reconcilePresentation({
      html,
      index,
      sourceLabel: capability.format.toUpperCase(),
    })
    const blocker = reconciled.findings.find((finding) => finding.severity === 'blocker')
    if (blocker) {
      /*
       * `reconcilePresentation` still returns HTML built on the disagreement it
       * just raised a blocker over (its own comment: "nothing publishes on a
       * blocker" — enforcing that is the caller's job). A DOCX footnote or
       * equation blocker names ONE block anydoc could not render while every
       * other block on the page stays correctly placed, so `document.ts`
       * returns those results normally and lets `ImportPlanEditor`'s blocker
       * gate stop publishing. A presentation blocker is not that: it means the
       * page's own claim about which slide held what may be wrong from that
       * point forward (reconcile.ts's own opening comment: "Silent
       * misattribution... is the one outcome this module exists to prevent").
       * There is no safe partial page to hand to a plan editor, so this
       * importer refuses the whole file outright instead of trusting every
       * future reader of `findings` to check severity before rendering
       * `work.sections[0].html`.
       */
      throw new Error(blocker.message)
    }
    html = reconciled.html
    presentationFindings.push(...reconciled.findings)
  }

  const visibleText = html.replace(/<[^>]*>/g, '').trim()
  // A figure-only document (a cover page, a plate section) now normalizes to
  // something like `<p><img ...></p>` with no visible TEXT at all, since a
  // packageable image no longer leaves an `[Embedded image: ...]` text
  // placeholder behind. This guard used to be safe assuming every image left
  // text; it is not safe to assume that anymore, so it must also check for
  // real rendered media (`<img>`/`<hr>`) before declaring the document
  // empty — mirroring the identical check the sibling HTML/Markdown importer
  // already applies (`markup.ts`'s `!textContent?.trim() && !querySelector('img, hr')`).
  if (!visibleText) {
    const rendered = new DOMParser().parseFromString(html, 'text/html')
    if (!rendered.querySelector('img, hr')) {
      throw new Error(`AnyDoc found no readable structured content in this ${capability.label} file.`)
    }
  }

  const title = options.metadata.title.trim()
  const { id, sectionId } = documentIds(sourceSha256)
  const findings = [...parsed.normalized.findings, ...presentationFindings]
    .map((finding) => ({ ...finding, sectionId }))

  return {
    work: {
      id,
      title,
      format: capability.format,
      sections: [{ id: sectionId, title, order: 0, html }],
      // `name` is carried through as-is from the packaged record: it is
      // assigned once at import (`prepareAssets`), deduped by content hash
      // with the first-seen origin winning the name, and the HTML already
      // references that exact name via the `$IMS-CC-FILEBASE$/oer2canvas/`
      // token. Recomputing it here from `originPart` would disagree with
      // that reference whenever this occurrence isn't the first-seen one.
      assets: parsed.normalized.packagedAssets.map((asset) => ({
        id: asset.sha256,
        mediaType: asset.mediaType,
        extension: asset.extension,
        bytes: asset.bytes,
        sha256: asset.sha256,
        originPart: asset.originPart,
        name: asset.name,
      })),
      provenance: importProvenance(options.metadata, { kind: 'local-file', originalName: file.name }),
    },
    report: {
      parser: 'anydoc',
      parserVersion: parsed.parserVersion,
      format: capability.format,
      originalName: file.name,
      originalBytes: parsed.inputBytes,
      sourceSha256,
      findings,
      counts: {
        sections: 1,
        headings: parsed.counts.headings,
        tables: parsed.counts.tables,
        images: parsed.counts.images,
        equations: parsed.normalized.equations,
        notes: parsed.normalized.notes,
        unavailableAssets: parsed.normalized.unavailableAssets,
        packagedAssetBytes: parsed.normalized.packagedAssets.reduce(
          (total, asset) => total + asset.bytes.byteLength,
          0,
        ),
      },
    },
  }
}
