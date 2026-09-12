# IDEA model providers — browser-direct CORS probe — 2026-09-12

Origin under test: http://127.0.0.1:55426. No key sent; the request is expected to fail authentication readably.

| Provider | Endpoint | Preflight | allow-origin | allow-headers has authorization | Keyless POST | Terms URL resolves | Offered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Gemini AI Studio | https://generativelanguage.googleapis.com/v1beta/openai/chat/completions | 200 | http://127.0.0.1:55426 | true | HTTP 400 | true | yes |
| OpenRouter | https://openrouter.ai/api/v1/chat/completions | 204 | * | true | HTTP 401 | true | yes |
| Ollama Cloud | https://ollama.com/v1/chat/completions | 405 | (absent) | false | opaque: TypeError: Failed to fetch | true | NO |

Reproduce with `npm run verify:idea-llm-cors`. Update `src/engine/idea/llm/providers.ts` `offered` flags to match this table, and cite this file in the commit.
