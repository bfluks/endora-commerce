# @endora-commerce/llm-client

## 0.108.0

### Patch Changes

- Updated dependencies [0bd5a2b]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [5bddd11]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0

## 0.107.0

### Minor Changes

- 8397b0f: New package `@endora-commerce/llm-client`: the platform's provider-neutral LLM transport — the fetch-based `AnthropicAdapter`, `GoogleAdapter` and `OpenAiAdapter` with tool calling, `LlmProviderError`, and the `createLlmAdapter(provider, { apiKey, baseUrl?, fetchImpl? })` factory. Moved from `@endora-commerce/mod-prompt-actions`, which now builds its adapters through it; a request without the new options is sent byte for byte as before. `LlmRequest` gains an optional `toolChoice: { name }` (forces that tool on every provider) and `signal` (passed to `fetch`), and `LlmProviderError` an `aborted` flag for a request its signal cancelled.
- 8397b0f: LLM configurations can now reach DeepSeek and any OpenAI-compatible endpoint. The `llm` credential type gains the provider `openai_compatible` ("OpenAI-compatible (custom endpoint)"), whose Base URL is required; every `llm` provider's Base URL is validated on save as an absolute `http://` or `https://` URL through the new optional `FieldDefinition.format: 'url'`, and the credential form renders such a field as a URL input. `createLlmAdapter` honours the Base URL for `openai`, `deepseek` (default `https://api.deepseek.com`) and `openai_compatible`, and throws `LlmConfigurationError` for a missing or invalid one. `LlmProviderSchema` in `@endora-commerce/contracts` is the one provider list (`PromptActionsProviderSchema` is now its alias), and the AI assistant accepts DeepSeek and OpenAI-compatible configurations where it used to report them as not configured.

### Patch Changes

- Updated dependencies [fcf4d09]
- Updated dependencies [70bb5e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/contracts@0.107.0
