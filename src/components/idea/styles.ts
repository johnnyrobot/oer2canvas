/**
 * The class strings the IDEA components share. One copy each: the 36 px
 * target (WCAG 2.5.8, the same string `AppShell` uses), the text field, and
 * the two button shapes, the card, and the three table cells. A component
 * with a one-off variant builds it from these rather than restating them.
 */
export const TARGET = 'min-h-9 min-w-9'
export const FIELD =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
export const PRIMARY = `${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`
export const QUIET = `${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`
export const CARD =
  'flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
export const TABLE = 'w-full border-collapse text-sm'
export const TH = 'border-b border-neutral-300 py-1 pr-3 text-left font-semibold dark:border-neutral-700'
export const TD = 'border-b border-neutral-200 py-1 pr-3 align-top dark:border-neutral-800'
