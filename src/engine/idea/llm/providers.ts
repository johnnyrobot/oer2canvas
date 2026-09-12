/**
 * The three presets. All speak the OpenAI chat-completions dialect with a
 * Bearer key, which is why one client serves them.
 *
 * `offered` is EVIDENCE, not intent: it is set from the table in
 * docs/evidence/idea-llm-cors-<date>.md, and a provider a browser origin
 * cannot reach directly is not offered. There is no relay fallback, because
 * the key must never transit the server.
 *
 * `dataUse` is the sentence shown beside the key field. It does not
 * paraphrase the provider's terms — the link does that — it says what THIS
 * app sends and that the provider's terms govern what happens next.
 */
export type ProviderId = 'gemini' | 'openrouter' | 'ollama'

export interface LlmProvider {
  id: ProviderId
  label: string
  baseUrl: string
  defaultModel: string
  extraHeaders?: Record<string, string>
  dataUse: string
  termsUrl: string
  /** From the CORS probe. False = listed as "not available from the browser". */
  offered: boolean
  /** The evidence file the `offered` flag was read from. */
  evidence: string
}

const EVIDENCE = 'docs/evidence/idea-llm-cors-2026-09-12.md'

export const PROVIDERS: readonly LlmProvider[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    dataUse: 'This section’s text and image descriptions go from your browser to Google’s Gemini API on your key. Google’s Gemini API terms govern how they use it.',
    termsUrl: 'https://ai.google.dev/gemini-api/terms',
    offered: true,
    evidence: EVIDENCE,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    // OpenRouter's attribution headers; the deployed origin from wrangler.jsonc.
    extraHeaders: { 'HTTP-Referer': 'https://oer2canvas.johnnyrobot.dev', 'X-Title': 'oer2canvas' },
    dataUse: 'This section’s text and image descriptions go from your browser to OpenRouter on your key, and from OpenRouter to the model provider you chose. OpenRouter’s privacy policy and that provider’s terms govern how they use it.',
    termsUrl: 'https://openrouter.ai/privacy',
    offered: true,
    evidence: EVIDENCE,
  },
  {
    id: 'ollama',
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com/v1',
    defaultModel: 'gpt-oss:120b',
    dataUse: 'This section’s text and image descriptions go from your browser to Ollama Cloud on your key. Ollama’s terms govern how they use it.',
    termsUrl: 'https://ollama.com/terms',
    // Measured 2026-09-12: the preflight answers 405 with no allow-origin, so
    // a browser cannot read the response. Listed so the user learns why.
    offered: false,
    evidence: EVIDENCE,
  },
]

export function providerById(id: ProviderId): LlmProvider {
  const p = PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown provider ${id}`)
  return p
}
