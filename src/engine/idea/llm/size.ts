/**
 * The size guard for the one request that can be large: the book review.
 * Estimated, not tokenised — the point is a number the instructor can act on
 * before pressing Send, and a refusal above the provider's ceiling instead
 * of a truncated chapter. Nothing here shortens anything.
 */
import type { LlmProvider } from './providers'

type Msg = { role: 'system' | 'user'; content: string }

/** Four characters per token, the rule of thumb every provider's docs give; rounded up. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** Over the serialised messages — what the body will carry, not just the text. */
export const promptTokens = (messages: readonly Msg[]): number => estimateTokens(JSON.stringify(messages))

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length

export const overCeiling = (tokens: number, provider: LlmProvider): boolean => tokens > provider.contextTokens
