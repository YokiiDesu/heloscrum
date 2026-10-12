# Muse Glimmer Red-Ball Example

Public-safe provenance for the [local LLM article](../website/blog/local-llms.html).
Only the requested demo and selected measurements are published. Personal paths,
connection/session IDs, credentials, and the full private handoff are omitted.

## Recorded Build

Source: the local HeloScrum managed-session events, model usage records, and
llama.cpp timing log inspected on October 12, 2026. The successful llama.cpp turn
resumed a Builder after a provider switch, using its reviewed handoff. It was
not a clean-session benchmark of the short original brief alone.

| Event | UTC, October 12, 2026 | Elapsed |
| --- | --- | --- |
| Successful turn received | 20:41:56.802 | 0 |
| `workspace_write` completed, `index.html` | 20:43:37.224 | 100.422 s |
| `notebook_write` completed | 20:43:50.749 | 113.947 s |
| Final assistant reply | 20:43:54.811 | 118.009 s |

The first response used 5,764 prompt tokens and 2,584 completion tokens.
llama.cpp reported 8,576.81 ms prompt evaluation and 91,813.16 ms generation,
with 28.13 generated tokens/s. Two more responses wrote the notebook entry and
finished the reply. The complete turn generated 2,980 tokens across those three
responses. Follow-up questions are excluded.

The model was loaded before the measured turn. Download/load time, earlier
LM Studio attempts, and later browser checks are excluded. No fixed seed was
used. This is one observed run, not a cross-runtime performance comparison.

## Configuration

- Apple M5 Max, 51,539,607,552 bytes (48 GiB) unified memory; macOS 26.6.2.
- llama.cpp 0.6.0, build 11429, commit `d81235049`, Darwin arm64.
- `Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf` with its matching
  `mmproj-Muse-Glimmer-30B-Q4_K_M.gguf` from LM Studio Community.
- Alias `meta/muse-glimmer`, `127.0.0.1:8080`, context 32768, one parallel slot,
  all GPU layers, Flash Attention on, offline, UI off, CORS origins `localhost`.
- HeloScrum saved connection: llama.cpp, `/v1`, maximum output 8192,
  tools/images enabled; no key for this loopback-only endpoint.
- No sampling or reasoning-effort overrides sent by HeloScrum. Running server
  defaults read from `/props`: temperature 0.8, top-k 40, top-p 0.95, min-p 0.05,
  repeat penalty 1.0, random seed sentinel 4294967295.
- No image was supplied for this task. No new inference was used to create the article.

## Artifact

`website/demos/red-ball-original.html` is the exact model-written file:

- Bytes: 4,862
- SHA-256: `5f9a5c765a5c83dc5b235f58a1375a34db833434d1dbd8a1b72bcb17279e505e`

`.gitattributes` preserves LF line endings for both demo files, including Windows
checkouts, so the original download and inline CSP hashes remain byte-identical.

`red-ball.html` adds only CSP/referrer metadata. The original CSS and JavaScript
are unchanged. Hash-based CSP permits only those inline blocks, blocks network
connections and other resources, and forbids form submissions. The article's
iframe has `sandbox="allow-scripts"`, without same-origin access. Local serving
also applies the sandbox through a response header and allows embedding only
for this reviewed demo, not application pages. The original is served as a download.

The walkthrough uses the recorded settings, original brief, tool actions,
full final reply, and milestones. It sends no inference requests. The model
sent no intermediate assistant chat messages during the successful turn.
The embedded demo starts on demand and is removed on Stop, when offscreen, or
when the tab is hidden. The optional 8.5-second tool animation progressively reveals the original HTML
and exact notebook text; it is labeled illustrative and does not claim to replay
internal thinking or actual incremental writes. Reduced-motion users advance
through the full file, note, and result manually.

The generated prototype uses pointer controls and frame-dependent physics;
keyboard play and normalized simulation timing were not added to the artifact.
