/**
 * Finding the publisher's caption — the detection the slices 1-3 outcome asked for.
 *
 * OpenStax has no `<figcaption>` anywhere; verified, zero occurrences in either
 * committed fixture. What it has is `<div class="os-caption-container">`, and
 * critically that div is a following SIBLING of the `<figure>`, not a child:
 * the markup reads `</figure><div class="os-caption-container">`. A transform
 * written around a figure/figcaption pair finds nothing here.
 */
import type { PublisherProfile } from '../context'

export function findCaption(el: Element, profile: PublisherProfile): Element | null {
  const inside = el.querySelector(profile.captionContainer)
  if (inside) return inside
  if (!profile.captionIsSibling) return null
  const next = el.nextElementSibling
  return next?.matches(profile.captionContainer) ? next : null
}

/** The caption's text, whitespace-collapsed. OpenStax captions are full of newlines. */
export function captionText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * The caption's description: what it says about the picture, minus what it says
 * about itself.
 *
 * Read from the publisher's own descriptive element when there is one, which is
 * what makes the label and the credit fall away without a regex having to guess
 * where one ends and the other begins. OpenStax always structures a real caption
 * this way; the committed 1.4 fixture is the unrepresentative label-only case.
 *
 * Falls back to the whole caption text when the publisher has no descriptive
 * sub-element, because a caption with no structure is still better than nothing
 * — minus a credit line, which is never a description. A caption that is ONLY a
 * label is handled by the caller, which drops it rather than proposing
 * "Figure 1" as alt text.
 */
export function captionDescriptionText(el: Element, profile: PublisherProfile): string {
  const described = el.querySelector(profile.captionDescription)
  if (described) return captionText(described)
  return captionText(el).replace(profile.captionCredit, '').trim()
}
