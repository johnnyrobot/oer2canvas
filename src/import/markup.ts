import { Marked } from 'marked'
import { escapeHtml } from './html'
import type { ImportFinding } from './types'

const markdown = new Marked({
  async: false,
  breaks: false,
  gfm: true,
  pedantic: false,
})
markdown.use({
  extensions: [{
    name: 'documentMath',
    level: 'inline',
    start(source) {
      const index = source.search(/\\[([]/)
      return index >= 0 ? index : undefined
    },
    tokenizer(source) {
      const match = /^(?:\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\])/.exec(source)
      return match ? { type: 'documentMath', raw: match[0] } : undefined
    },
    renderer: (token) => escapeHtml(token.raw),
  }],
})

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdo', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div',
  'dl', 'dt', 'em', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'i', 'img', 'ins', 'kbd', 'li', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'samp',
  'section', 'small', 'span', 'strike', 'strong', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',
])

const ACTIVE_DROP_TAGS = new Set([
  'applet', 'audio', 'base', 'embed', 'iframe', 'link', 'object', 'script', 'style',
  'svg', 'template', 'video',
])

const ACTIVE_UNWRAP_TAGS = new Set([
  'button', 'datalist', 'fieldset', 'form', 'input', 'label', 'optgroup', 'option',
  'output', 'select', 'textarea',
])

const GLOBAL_ATTRIBUTES = new Set(['dir', 'id', 'lang', 'role', 'title'])
const ARIA_ATTRIBUTES = new Set([
  'aria-atomic', 'aria-autocomplete', 'aria-busy', 'aria-checked', 'aria-controls',
  'aria-describedby', 'aria-disabled', 'aria-dropeffect', 'aria-expanded', 'aria-flowto',
  'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid', 'aria-label',
  'aria-labelledby', 'aria-level', 'aria-live', 'aria-multiline', 'aria-multiselectable',
  'aria-orientation', 'aria-owns', 'aria-pressed', 'aria-readonly', 'aria-relevant',
  'aria-required', 'aria-selected', 'aria-sort', 'aria-valuemax', 'aria-valuemin',
  'aria-valuenow', 'aria-valuetext',
])
const ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'target']),
  abbr: new Set(['title']),
  blockquote: new Set(['cite']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  img: new Set(['alt', 'height', 'src', 'title', 'width']),
  ol: new Set(['start', 'type']),
  q: new Set(['cite']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['abbr', 'colspan', 'rowspan', 'scope']),
}

const LINK_SCHEMES = new Set(['http', 'https', 'mailto'])
const MEDIA_SCHEMES = new Set(['http', 'https'])

interface RepairSummary {
  active: Set<string>
  dangerousUrls: Set<string>
  unsupported: Set<string>
  unsafeAttributes: Set<string>
  unavailableLinks: number
  unavailableImages: number
  images: number
}

export interface MarkupSanitizationOptions {
  publicBaseUrl?: URL
}

export interface SanitizedMarkup {
  html: string
  findings: ImportFinding[]
  counts: {
    headings: number
    tables: number
    images: number
    equations: number
    notes: number
    unavailableAssets: number
  }
}

function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes)
}

function allowedAttribute(tag: string, name: string, value: string): boolean {
  if (GLOBAL_ATTRIBUTES.has(name) || ARIA_ATTRIBUTES.has(name)) return true
  if (tag === 'code' && name === 'class') return /^language-[A-Za-z0-9_-]+$/.test(value)
  return ELEMENT_ATTRIBUTES[tag]?.has(name) ?? false
}

function schemeOf(value: string): string | undefined {
  const compact = value.replace(/[\u0000-\u0020]/g, '')
  return /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(compact)?.[1]?.toLowerCase()
}

function isDangerousUrl(tag: string, attribute: string, value: string): boolean {
  const scheme = schemeOf(value)
  if (!scheme) return false
  const allowed = tag === 'img' && attribute === 'src' ? MEDIA_SCHEMES : LINK_SCHEMES
  return !allowed.has(scheme)
}

function isRelativeUrl(value: string): boolean {
  const trimmed = value.trim()
  return !schemeOf(trimmed) && !trimmed.startsWith('//')
}

type AttributeRestriction = 'active' | 'dangerous'

function attributeRestriction(tag: string, name: string, value: string): AttributeRestriction | undefined {
  if (name.startsWith('on')) return 'active'
  if ((name === 'href' || name === 'src' || name === 'cite') && isDangerousUrl(tag, name, value)) {
    return 'dangerous'
  }
  return undefined
}

function recordAttributeRestriction(
  summary: RepairSummary,
  restriction: AttributeRestriction,
  tag: string,
  name: string,
): void {
  if (restriction === 'active') summary.active.add(`${name} handler`)
  else summary.dangerousUrls.add(`${name} on <${tag}>`)
}

function recordDiscardedAttributes(
  element: Element,
  tag: string,
  summary: RepairSummary,
  discloseAll: boolean,
): void {
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase()
    const restriction = attributeRestriction(tag, name, attribute.value)
    if (restriction) {
      recordAttributeRestriction(summary, restriction, tag, name)
    } else if (discloseAll) {
      summary.unsafeAttributes.add(`${name} on <${tag}>`)
    }
  }
}

function countDelimitedEquations(root: ParentNode): number {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (text.parentElement?.closest('pre, code')) continue
    count += [...text.data.matchAll(/\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g)].length
  }
  return count
}

function describe(values: ReadonlySet<string>): string {
  return [...values].sort().join(', ')
}

function findingsFrom(summary: RepairSummary): ImportFinding[] {
  const findings: ImportFinding[] = []
  if (summary.active.size > 0) {
    findings.push({
      code: 'import-active-content-removed',
      severity: 'warning',
      message: `Removed active content that could execute or submit data: ${describe(summary.active)}.`,
    })
  }
  if (summary.dangerousUrls.size > 0) {
    findings.push({
      code: 'import-dangerous-url-removed',
      severity: 'warning',
      message: `Removed unsafe URL values from: ${describe(summary.dangerousUrls)}.`,
    })
  }
  if (summary.unavailableLinks > 0) {
    const count = summary.unavailableLinks
    findings.push({
      code: 'import-relative-link-unavailable',
      severity: 'warning',
      message: `Removed ${count} unresolved relative URL ${count === 1 ? 'reference' : 'references'}. Link text and surrounding content were preserved. Add a public source URL to resolve relative links.`,
    })
  }
  if (summary.unavailableImages > 0) {
    const count = summary.unavailableImages
    findings.push({
      code: 'import-relative-image-unavailable',
      severity: 'blocker',
      message: `${count} ${count === 1 ? 'image uses' : 'images use'} a relative or removed source that cannot be packaged yet. Alternative text was retained where supplied. Add an absolute HTTPS image URL or remove the image before preparing this page.`,
    })
  }
  if (summary.unsupported.size > 0) {
    findings.push({
      code: 'import-unsupported-element-removed',
      severity: 'warning',
      message: `Removed unsupported element wrappers while preserving supported text: ${describe(summary.unsupported)}.`,
    })
  }
  if (summary.unsafeAttributes.size > 0) {
    findings.push({
      code: 'import-unsafe-attribute-removed',
      severity: 'warning',
      message: `Removed unsupported or unsafe attributes: ${describe(summary.unsafeAttributes)}.`,
    })
  }
  return findings
}

/**
 * Parse untrusted markup into a detached inert document, then retain only the
 * semantic subset this importer promises. The returned bytes are safe to mount;
 * the downstream Canvas allowlist still runs as the final publication gate.
 */
export function sanitizeImportedHtml(
  source: string,
  options: MarkupSanitizationOptions = {},
): SanitizedMarkup {
  const document = new DOMParser().parseFromString(source, 'text/html')
  const summary: RepairSummary = {
    active: new Set(),
    dangerousUrls: new Set(),
    unsupported: new Set(),
    unsafeAttributes: new Set(),
    unavailableLinks: 0,
    unavailableImages: 0,
    images: 0,
  }

  for (const element of document.querySelectorAll('script, style, link, base, meta[http-equiv]')) {
    const tag = element.localName.toLowerCase()
    summary.active.add(`<${tag}>`)
    recordDiscardedAttributes(element, tag, summary, false)
  }
  for (const element of document.head.querySelectorAll('*')) {
    const tag = element.localName.toLowerCase()
    if (ACTIVE_DROP_TAGS.has(tag) || (tag === 'meta' && element.hasAttribute('http-equiv'))) continue
    summary.unsupported.add(`<${tag}>`)
    recordDiscardedAttributes(element, tag, summary, true)
  }

  const elements = [...document.body.querySelectorAll('*')].reverse()
  for (const element of elements) {
    const tag = element.localName.toLowerCase()
    if (ACTIVE_DROP_TAGS.has(tag)) {
      summary.active.add(`<${tag}>`)
      recordDiscardedAttributes(element, tag, summary, false)
      element.remove()
      continue
    }
    if (tag === 'meta' && element.hasAttribute('http-equiv')) {
      summary.active.add('<meta>')
      recordDiscardedAttributes(element, tag, summary, false)
      element.remove()
      continue
    }
    if (ACTIVE_UNWRAP_TAGS.has(tag)) {
      summary.active.add(`<${tag}>`)
      recordDiscardedAttributes(element, tag, summary, false)
      unwrap(element)
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      summary.unsupported.add(`<${tag}>`)
      recordDiscardedAttributes(element, tag, summary, true)
      unwrap(element)
      continue
    }

    let unwrapRelativeLink = false
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const restriction = attributeRestriction(tag, name, attribute.value)
      if (restriction) {
        recordAttributeRestriction(summary, restriction, tag, name)
        element.removeAttribute(attribute.name)
        continue
      }
      if (!allowedAttribute(tag, name, attribute.value)) {
        summary.unsafeAttributes.add(`${name} on <${tag}>`)
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'target' && !['_blank', '_self'].includes(attribute.value.toLowerCase())) {
        summary.unsafeAttributes.add(`target on <${tag}>`)
        element.removeAttribute(attribute.name)
        continue
      }
      if (
        (name === 'href' || name === 'src' || name === 'cite')
        && isRelativeUrl(attribute.value)
        && !(tag === 'a' && name === 'href' && attribute.value.trim().startsWith('#'))
      ) {
        if (options.publicBaseUrl) {
          try {
            element.setAttribute(attribute.name, new URL(attribute.value, options.publicBaseUrl).href)
          } catch {
            element.removeAttribute(attribute.name)
            if (tag === 'a' && name === 'href') unwrapRelativeLink = true
            if (name !== 'src') summary.unavailableLinks += 1
          }
        } else if (tag === 'a' && name === 'href') {
          unwrapRelativeLink = true
          summary.unavailableLinks += 1
        } else if (name !== 'src') {
          element.removeAttribute(attribute.name)
          summary.unavailableLinks += 1
        }
      }
    }

    if (tag === 'img') {
      summary.images += 1
      const src = element.getAttribute('src')
      if (!src || isRelativeUrl(src)) {
        summary.unavailableImages += 1
        const alt = element.getAttribute('alt')?.trim()
        element.replaceWith(alt ? document.createTextNode(alt) : document.createTextNode(''))
        continue
      }
    }
    if (unwrapRelativeLink) unwrap(element)
  }

  const comments: Comment[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) comments.push(node as Comment)
  for (const comment of comments) comment.remove()

  const html = document.body.innerHTML.trim()
  const findings = findingsFrom(summary)
  const retained = new DOMParser().parseFromString(html, 'text/html')
  if (!retained.body.textContent?.trim() && !retained.querySelector('img, hr')) {
    findings.push({
      code: 'import-no-supported-content',
      severity: 'blocker',
      message: 'No supported semantic content remained after active and unsupported material was removed.',
    })
  }

  return {
    html,
    findings,
    counts: {
      headings: retained.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      tables: retained.querySelectorAll('table').length,
      images: summary.images,
      equations: countDelimitedEquations(retained.body),
      notes: retained.querySelectorAll('aside[role="note"]').length,
      unavailableAssets: summary.unavailableImages,
    },
  }
}

export function sanitizeImportedMarkdown(
  source: string,
  options: MarkupSanitizationOptions = {},
): SanitizedMarkup {
  return sanitizeImportedHtml(markdown.parse(source) as string, options)
}
