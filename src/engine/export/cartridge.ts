import { auditedHtml, type CompiledChapter, type CompiledSection } from '../../contracts/index'
import { isPackagedReference, packagedArchivePath, packagedReference } from '../../import/assets'
import { pageTargetsByChapter, slug } from './page-identity'
import type { ZipEntry } from './zip'

/**
 * A `CompiledChapter[]` becomes the file tree of a Common Cartridge.
 *
 * THE INVARIANT THAT IS NOT NEGOTIABLE: the cartridge publishes
 * `CompiledSection.html` VERBATIM. Not re-parsed, not re-serialised, not run
 * through another transform on the way out. Those are the exact bytes the audit
 * passed — `iframe-runner` takes the same care on the way in, putting the
 * fragment into the audit frame as markup "so the audit sees exactly the bytes
 * that would be published". If the export re-derived the html, the audited
 * artifact and the published artifact would be two different things and the
 * gate's verdict would stop meaning anything about the file the instructor
 * imports. That is the product's whole claim.
 *
 * The fragment is CONCATENATED into a minimal document shell, never parsed into
 * one. A cartridge resource has to be a document and the audit ran on a
 * fragment, so a wrapper is unavoidable; string concatenation is how it stays
 * byte-exact.
 *
 * ONE RESOURCE PER SECTION, NOT PER CHAPTER — see `shell/plan.ts` for why. A
 * chapter of twelve sections is twelve Canvas pages.
 *
 * CC 1.1, IN CANVAS'S OWN FLAVOUR — and the flavour is not decoration.
 *
 * MEASURED, by importing a generic cartridge into a live Canvas: it succeeded,
 * reported "Completed", built the modules with the right titles in the right
 * order, stored every byte intact... and created ZERO PAGES. Canvas has two
 * importers. The generic Common Cartridge one treats `type="webcontent"` html as
 * FILES and hangs them off modules as attachments; only the Canvas Course Export
 * path maps `wiki_content/*.html` to wiki pages. It picks between them by the
 * presence of `course_settings/canvas_export.txt`, so that marker is the
 * difference between this product working and this product producing a folder
 * full of html attachments nobody can read in place.
 *
 * The trade is real and was taken deliberately: this package is aimed at Canvas
 * rather than at any CC-conforming LMS. E6 said "Common Cartridge", and a
 * portable cartridge that puts the content somewhere useless is not what it
 * meant. Everything here still IS a valid CC 1.1 archive — the marker and the
 * Canvas metadata are additive — so a different LMS gets what it always would
 * have got.
 */

const CC11_NS = 'http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1'
const CC11_LOM = 'http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource'

/** XML text escape. Titles are publisher-supplied and contain `&` routinely. */
function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}


/**
 * An XML identifier for a section.
 *
 * Derived from the section id rather than from array position, so that exporting
 * the same selection twice produces the same identifiers. Position-derived ids
 * would renumber every resource whenever a chapter was added, which makes two
 * exports of overlapping selections impossible to compare.
 *
 * `xsd:ID` must start with a letter or underscore, hence the prefix.
 */
function resourceId(section: CompiledSection): string {
  return `res-${section.id.replace(/[^A-Za-z0-9._-]/g, '-')}`
}

interface Page {
  section: CompiledSection
  chapterTitle: string
  path: string
  id: string
}

/**
 * THE FILENAME IS THE PAGE URL, so the slug comes from `page-identity` rather
 * than from here — see that module for why the push has to agree with it.
 */
function pagesOf(chapters: readonly CompiledChapter[]): Page[][] {
  return pageTargetsByChapter(chapters).map((group) =>
    group.map((t) => ({
      section: t.section,
      chapterTitle: t.chapterTitle,
      path: `wiki_content/${t.slug}.html`,
      id: resourceId(t.section),
    })),
  )
}

/** One asset actually shipped in the archive, keyed by content once per cartridge. */
export interface PackagedAsset {
  archivePath: string
  bytes: Uint8Array
  resourceId: string
}

/**
 * Thrown by `collectPackagedAssets` when the gated html carries a
 * `$IMS-CC-FILEBASE$/oer2canvas/...` reference that no asset backs.
 *
 * This is not defensive paranoia against code that "shouldn't" produce such a
 * thing. The allowlist admits this exact token shape into `img.src` (see
 * `allowlist.ts`), and the Markdown/HTML import path accepts arbitrary author
 * markup, so a hand-typed token can legitimately reach this point. It also
 * catches our own naming bugs — a reference and its archive entry disagreeing
 * is exactly the failure mode the "use `asset.name` verbatim" rule below
 * exists to prevent. Either way, shipping a cartridge with a dangling
 * reference would hand the instructor a page with a broken image and no
 * signal of why; throwing here fails the export loudly instead, while there
 * is still a stack trace attached to the cause.
 */
export class UnresolvedPackagedReferenceError extends Error {
  constructor(references: readonly string[]) {
    super(
      'Cartridge references no packaged file: ' +
        references.join(', ') +
        '. Every $IMS-CC-FILEBASE$ reference must resolve to an entry in this archive.',
    )
    this.name = 'UnresolvedPackagedReferenceError'
  }
}

/**
 * Every `$IMS-CC-FILEBASE$/oer2canvas/...` value the gated html actually
 * carries as an ATTRIBUTE — never a raw-text scan over the serialized string.
 *
 * A regex over the serialized html (the first version of this function used
 * `/\$IMS-CC-FILEBASE\$\/oer2canvas\/[^"'\s>]+/g`) matches the token
 * wherever it sits, including inside ordinary prose: a page that both embeds
 * an image AND mentions its own path in a caption —
 * `<img src="$IMS-CC-FILEBASE$/oer2canvas/x.png"><p>The file is
 * $IMS-CC-FILEBASE$/oer2canvas/x.png.</p>` — would have that regex capture
 * `x.png.</p` out of the prose occurrence (nothing in the excluded-character
 * class stops at `<`), which then fails `isPackagedReference` and makes
 * `collectPackagedAssets` throw on a page that is perfectly valid. Parsing
 * with `DOMParser` and reading actual attribute VALUES sidesteps the whole
 * class of bug rather than patching this one shape of it: html the browser's
 * own parser has already separated into elements and attributes has no tag
 * boundary left to run across, and prose text is never an attribute value in
 * the first place. `DOMParser.parseFromString` executes no script and loads
 * no subresource, and the document it builds is never attached to the live
 * one — the same property `compileSection` (src/engine/compile/index.ts)
 * relies on for the same reason.
 */
function packagedReferencesIn(html: string): Set<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const found = new Set<string>()
  for (const element of doc.body.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (isPackagedReference(attribute.value)) found.add(attribute.value)
    }
  }
  return found
}

/**
 * Every distinct asset the emitted pages actually reference, deduped by
 * archive path, plus a hard check that every reference the gated html carries
 * resolves to one of them.
 *
 * THE NAME COMES FROM `asset.name`, NEVER RECOMPUTED. `prepareAssets`
 * (src/import/assets.ts) already decided each asset's one true archive name
 * at import time, deduping by content hash: the FIRST-SEEN occurrence's
 * origin wins the slug, and every later occurrence of that same content keeps
 * its OWN `originPart` (where that particular occurrence came from) while
 * carrying the already-decided shared `name`. Rerunning `packagedAssetName`
 * on a non-winning occurrence's `originPart` would happily produce a
 * DIFFERENT, perfectly plausible-looking slug — and a cartridge whose archive
 * entry disagrees with the reference already burned into the gated HTML,
 * e.g. shipping `two-<hash>.png` for a page that asks for `one-<hash>.png`.
 * `asset.name` is the one value the reference and the archive entry are
 * both required to agree on, so it is the only thing used to derive either.
 *
 * Dedup happens across the WHOLE cartridge (all chapters), not per chapter —
 * one export can carry several chapters that embed the same image, and
 * Canvas itself resolves duplicate uploads sharing content to one `File`, so
 * shipping the same bytes twice would just be dead weight with two names
 * fighting over the same content.
 *
 * An asset that nothing in the emitted pages references is simply left out:
 * the archive holds exactly what the pages ask for, no more. An asset that
 * IS referenced but missing from `Chapter.assets` (or renamed out from under
 * the reference) throws `UnresolvedPackagedReferenceError` instead of
 * silently shipping a page with a broken image.
 */
export function collectPackagedAssets(chapters: readonly CompiledChapter[]): PackagedAsset[] {
  const byReference = new Map<string, PackagedAsset>()
  for (const compiled of chapters) {
    for (const asset of compiled.chapter.assets ?? []) {
      const reference = packagedReference(asset.name)
      if (byReference.has(reference)) continue
      // `packagedAssetName` (src/import/assets.ts) sanitizes down to
      // `[a-z0-9-]` plus a known extension, and the allowlist fences what
      // reaches `img@src` — so `asset.name` SHOULD already be safe to turn
      // straight into an archive path. This module ships that path into a
      // zip entry and an XML `href` attribute, though, so "should" is not
      // enough: an unsanitized name (`../../wiki_content/x.html`, or one
      // containing `&`) would silently become a write path outside this
      // asset's own directory, or a manifest `href` that breaks XML
      // parsing. `isPackagedReference` is the exact predicate the allowlist
      // already widens `img.src` by, so re-running it here costs one line
      // and turns an unstated upstream invariant into one this module
      // enforces itself, dropping the asset instead of trusting it blindly.
      if (!isPackagedReference(reference)) continue
      byReference.set(reference, {
        archivePath: packagedArchivePath(asset.name),
        bytes: asset.bytes,
        // Derived from `name`, NOT from `sha256.slice(0, 8)`: `name` is
        // already unique per archive path by construction (it IS the archive
        // path's basename), while an 8-hex-character hash prefix is not —
        // two distinct assets can share one, which would emit two
        // `<resource>` elements with the identical `identifier`. That
        // `identifier` is an xsd:ID, so a collision is an INVALID manifest,
        // not a cosmetic one. `resourceId` function's own sanitizer
        // (`[^A-Za-z0-9._-]` -> `-`) is reused here for the same reason it
        // exists there: publisher-influenced text landing in an xsd:ID needs
        // the same narrow character set regardless of which kind of id it is.
        resourceId: `asset-${asset.name.replace(/[^A-Za-z0-9._-]/g, '-')}`,
      })
    }
  }

  // Scan `pagesOf(chapters)`, NOT every section in `chapters` directly — this
  // is deliberate, not an oversight. `pagesOf` (via `pageTargetsByChapter` in
  // `page-identity.ts`) already filters sections through `publishable`,
  // dropping any section that failed to compile (`error` set, `html` empty
  // per contract). Those never become a `wiki_content/*.html` entry in the
  // loop at the bottom of `buildCartridge`, so a stray reference trapped
  // inside one is not in the cartridge either and must not be able to fail
  // this build. Scanning `compiled.sections` instead would check html that is
  // never shipped — checking a superset of what actually goes in the archive,
  // rather than the archive's own contents.
  const referenced = new Set<string>()
  for (const page of pagesOf(chapters).flat()) {
    for (const reference of packagedReferencesIn(auditedHtml(page.section))) referenced.add(reference)
  }
  const unresolved = [...referenced].filter((reference) => !byReference.has(reference))
  if (unresolved.length > 0) throw new UnresolvedPackagedReferenceError(unresolved)

  return [...byReference.entries()].filter(([reference]) => referenced.has(reference)).map(([, asset]) => asset)
}

/**
 * Wrap the compiled fragment in the minimal document a cartridge resource needs.
 *
 * `<title>` is what Canvas reads for the page name on import, which is why it
 * carries the section title rather than being cosmetic.
 */
function documentFor(section: CompiledSection, id: string): string {
  return (
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>' +
    `<title>${xml(section.title)}</title>` +
    // Canvas reads these to build the WikiPage. `identifier` is what ties this
    // file to its manifest resource and its module item; without
    // `workflow_state` the page imports unpublished, which looks like a failed
    // import to an instructor who goes looking for it.
    `<meta name="identifier" content="${id}"/>` +
    '<meta name="editing_roles" content="teachers"/>' +
    '<meta name="workflow_state" content="active"/>' +
    '</head><body>' +
    // VERBATIM. Concatenated, never parsed.
    auditedHtml(section) +
    '</body></html>'
  )
}

export function buildManifest(chapters: readonly CompiledChapter[]): string {
  const groups = pagesOf(chapters)

  const organizations = groups
    .map((pages, i) => {
      const chapterTitle = chapters[i]!.chapter.title
      const items = pages
        .map(
          (p) =>
            `        <item identifier="item-${p.id}" identifierref="${p.id}">\n` +
            `          <title>${xml(p.section.title)}</title>\n` +
            `        </item>`,
        )
        .join('\n')
      return (
        `      <item identifier="mod-${i + 1}">\n` +
        `        <title>${xml(chapterTitle)}</title>\n` +
        `${items}\n` +
        `      </item>`
      )
    })
    .join('\n')

  /*
   * THE RESOURCE THAT MAKES THE MARKER COUNT.
   *
   * Shipping `course_settings/canvas_export.txt` in the archive is NOT enough —
   * measured twice, against a live Canvas, with both importers: the migration
   * completes, the modules build, and every page still arrives as a file
   * attachment. Canvas finds the marker through the MANIFEST, as a
   * `learning-application-resource` whose href points at it, and this element is
   * the difference between a folder of unreadable html and pages an instructor
   * can actually open.
   *
   * Copied from what a real Canvas course export emits, read out of an export of
   * this very instance rather than from documentation, because two rounds of
   * reasoning about the format had already produced two wrong answers.
   */
  const canvasSettings =
    `    <resource identifier="canvas-settings" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="course_settings/canvas_export.txt">\n` +
    `      <file href="course_settings/module_meta.xml"/>\n` +
    `      <file href="course_settings/canvas_export.txt"/>\n` +
    `    </resource>`

  const resources = groups
    .flat()
    .map(
      (p) =>
        `    <resource identifier="${p.id}" type="webcontent" href="${p.path}">\n` +
        `      <file href="${p.path}"/>\n` +
        `    </resource>`,
    )
    .join('\n')

  /*
   * ONE STANDALONE `webcontent` RESOURCE PER ASSET, WITH NO `<dependency>`
   * FROM ITS PAGE — MEASURED, not the more "obviously structured" option.
   * `docs/evidence/canvas-image-probes-2026-08-28.md` imported four candidate
   * cartridge layouts into a live Canvas. Two of them measured as Canvas
   * reporting "Completed" and then attaching zero course files: nesting the
   * asset as a second `<file>` under the PAGE's resource, and wrapping it in
   * `associatedcontent`. Do not add either "improvement" back without new
   * evidence.
   *
   * A THIRD SHAPE, `webcontent-dependencies` — this same standalone resource
   * plus a `<dependency identifierref="...">` from the page to it — also
   * passed every required behaviour. It is not "the only one that works";
   * the evidence doc breaks the tie toward THIS shape for being the simpler
   * manifest, not because the dependency-carrying one failed anything. So the
   * one fact actually pinned by measurement is narrower than "the only
   * shape" would suggest: a page resource declaring that dependency was
   * measured as OPTIONAL — present or absent, the import outcome was
   * identical — which is why it is omitted here, not because it was found to
   * be wrong.
   */
  const assetResources = collectPackagedAssets(chapters)
    .map(
      (asset) =>
        `    <resource identifier="${asset.resourceId}" type="webcontent" href="${asset.archivePath}">\n` +
        `      <file href="${asset.archivePath}"/>\n` +
        `    </resource>`,
    )
    .join('\n')

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<manifest identifier="oer2canvas-cartridge"\n` +
    `  xmlns="${CC11_NS}"\n` +
    `  xmlns:lom="${CC11_LOM}"\n` +
    `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <metadata>\n` +
    `    <schema>IMS Common Cartridge</schema>\n` +
    `    <schemaversion>1.1.0</schemaversion>\n` +
    `  </metadata>\n` +
    `  <organizations>\n` +
    `    <organization identifier="org-1" structure="rooted-hierarchy">\n` +
    `      <item identifier="root">\n` +
    `${organizations}\n` +
    `      </item>\n` +
    `    </organization>\n` +
    `  </organizations>\n` +
    `  <resources>\n` +
    `${canvasSettings}\n` +
    `${resources}\n` +
    // Omitted rather than spliced in blank when a cartridge packages no
    // assets at all, so a plain text-only export keeps the tidy manifest it
    // always produced instead of gaining a stray empty line.
    (assetResources ? `${assetResources}\n` : '') +
    `  </resources>\n` +
    `</manifest>\n`
  )
}

/**
 * Canvas's module manifest.
 *
 * `<content_type>WikiPage</content_type>` is the line that matters: it is how a
 * module item becomes a page reference rather than the file attachment a generic
 * cartridge produces.
 */
export function buildModuleMeta(chapters: readonly CompiledChapter[]): string {
  const groups = pagesOf(chapters)
  const modules = groups
    .map((pages, i) => {
      const items = pages
        .map(
          (p, j) =>
            `    <item identifier="item-${p.id}">\n` +
            `      <content_type>WikiPage</content_type>\n` +
            `      <workflow_state>active</workflow_state>\n` +
            `      <title>${xml(p.section.title)}</title>\n` +
            `      <identifierref>${p.id}</identifierref>\n` +
            `      <position>${j + 1}</position>\n` +
            `      <indent>0</indent>\n` +
            `    </item>`,
        )
        .join('\n')
      return (
        `  <module identifier="mod-${i + 1}">\n` +
        `    <title>${xml(chapters[i]!.chapter.title)}</title>\n` +
        `    <workflow_state>active</workflow_state>\n` +
        `    <position>${i + 1}</position>\n` +
        `    <require_sequential_progress>false</require_sequential_progress>\n` +
        `${items}\n` +
        `  </module>`
      )
    })
    .join('\n')

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<modules xmlns="http://canvas.instructure.com/xsd/cccv1p0"\n` +
    `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `${modules}\n` +
    `</modules>\n`
  )
}

/** The manifest plus one file per publishable section. Feed straight to `writeZip`. */
export function buildCartridge(chapters: readonly CompiledChapter[]): ZipEntry[] {
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = [
    { name: 'imsmanifest.xml', data: encoder.encode(buildManifest(chapters)) },
    /*
     * THE MARKER. Canvas chooses its importer by whether this file exists, and
     * that choice is the difference between wiki pages and a folder of html
     * attachments. Its CONTENTS are ignored — Canvas's own exports put a joke in
     * here — so it says what it is for, to whoever finds it in an archive and
     * wonders whether it is safe to drop.
     */
    {
      name: 'course_settings/canvas_export.txt',
      data: encoder.encode(
        'This marker tells Canvas to import wiki_content/*.html as Pages rather than\n' +
          'as file attachments. Measured, not assumed: without it a valid cartridge\n' +
          'imports cleanly and creates no pages at all. Do not remove it.\n',
      ),
    },
    { name: 'course_settings/module_meta.xml', data: encoder.encode(buildModuleMeta(chapters)) },
  ]
  for (const page of pagesOf(chapters).flat()) {
    entries.push({ name: page.path, data: encoder.encode(documentFor(page.section, page.id)) })
  }
  // Raw bytes, not re-encoded text: `asset.bytes` is already the exact raster
  // `prepareAssets` sniffed and hashed, so writing it verbatim is what keeps
  // the shipped file's sha256 the one Canvas would compute back from it.
  for (const asset of collectPackagedAssets(chapters)) {
    entries.push({ name: asset.archivePath, data: asset.bytes })
  }
  return entries
}

/**
 * Chapter and timestamp, per E6.
 *
 * THE TIMESTAMP IS ABOUT THE DOWNLOADS FOLDER, NOT ABOUT CANVAS — and this
 * comment used to say the opposite, in the indicative, because the PRD did.
 *
 * The old rationale was that "importing a cartridge never updates, it
 * duplicates", so two exports had to be told apart before either was imported.
 * Falsified by S6/Q5 on 2026-08-23: importing the same cartridge into the same
 * course a second time produced 8 pages and 8 pages, no duplicate titles, and
 * Canvas's own import screen says as much. It works because every page carries a
 * stable identifier derived from its section id — see `page-identity.ts`.
 *
 * The timestamp is kept, for the plainer reason that survives the correction: an
 * instructor who exports the same chapter twice ends up with two files, and a
 * filesystem does not merge them the way Canvas merges their contents. Without
 * it the second download is `chapter-1 (1).imscc` and neither name says which is
 * the newer one. Nothing here is a claim about what an import does.
 *
 * Publisher titles are arbitrary strings and routinely contain characters a
 * filesystem will not take, so the name is built from a slug rather than trusted.
 */
export function cartridgeFilename(chapters: readonly CompiledChapter[], now: Date): string {
  const stamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}-` +
    `${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}`
  const base =
    chapters.length === 1
      ? slug(chapters[0]!.chapter.title)
      : `${slug(chapters[0]!.chapter.title)}-and-${chapters.length - 1}-more`
  return `${base}-${stamp}.imscc`
}
