# Jev versus Voyage rerank-3

Start with the [embedding trial](voyage-retrieval-trial.md)'s saved report, then run:

```sh
node scripts/rerank-memory-trial.mjs
# Optionally choose an existing report:
HELOSCRUM_RERANK_REPORT=/absolute/path/voyage-retrieval-report.json node scripts/rerank-memory-trial.mjs
```

Open the printed localhost URL and enter both provider keys into its masked
fields. Keys remain in this process; neither is written to the report, browser
storage, application configuration or logs. Select **Clear both keys** or stop
the process when finished. This trial does not restart or configure live agents.

## Fixed comparison

The first report contains immutable source hashes and exact text ranges. Those
are validated against the same allowlisted documentation snapshot. For each
query, the candidate pool is the deduplicated union of its saved semantic top
three and keyword top three passages, at most six. Candidate selection does not
use gold labels. No embedding calls are needed. Missing evidence is counted
separately: a reranker cannot recover a passage outside its candidate pool.

The two providers receive the identical passage text, source fields, ordering,
status and freshness metadata. Jev uses HeloScrum's unchanged `memoryRankingRequest`
Noul questions and criteria; Voyage gets those same candidate objects serialized
as document strings. Jev additionally receives its instructions and criteria,
which are preserved in the report. This compares concrete integrations, not an
abstract capability independent of prompting or serialization.

- TypeSafe endpoint: `https://api.typesafe.ai/v1/systemone`, requested model
  `jev-latest`; record the actual returned model.
- Voyage endpoint: `https://api.voyageai.com/v1/rerank`, requested model
  `rerank-3`; disable truncation and retain every candidate's score.
- Results: three distinct documents, one passage each, at most 950 characters
  per passage. The exact-path query bypasses both models.
- No admission thresholds are tuned or applied. Preserve negative-query scores;
  a ranked candidate is not evidence that an answer exists. Noul is a probability
  of the specified usefulness judgment, not factual accuracy. Voyage scores are
  not treated as calibrated probabilities.

Seventeen queries make one request per provider. Calls for a query run as an
independent pair, with no more than two concurrent model requests. Each provider
has a 20-call / 350,000-request-byte ceiling; each request is at most 24,000 bytes,
has a 30-second timeout and a 1 MiB response limit. No automatic retries occur.
An explicit continuation reuses successful requests and respects any rate-limit
wait. Prior embedding usage is excluded from reranking usage.

## Evidence

The report keeps request state/questions, candidate hashes, raw model scores,
validation status, known and unknown usage, response sizes, and elapsed times.
It distinguishes absent candidates, invalid model/API responses, transport/service
failure and ranking outcomes. A checkpoint is written after each paired query;
continuation is in-process, while checkpoints remain evidence after a restart.
Final data is saved under ignored `output/rerank-trial/report.json` and can be
downloaded from the page. Neither file contains the keys.

Quality metrics are correct document at rank one/top three, and the exact labeled
evidence anchor in the returned passages. Bytes count the selected passage text.
Median and p95 timings use completed calls, including cold connections. This is
one sample per query on the same small development set used for the embedding
trial. It is not held-out calibration, repeated latency testing, an agent workflow
benchmark, or independent code review. Additional held-out queries and actual
workload validation are necessary before choosing production thresholds.

Primary references: [Voyage reranking](https://docs.voyageai.com/docs/reranker),
[TypeSafe reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe),
[TypeSafe Noul](https://docs.typesafe.ai/primitives/noul).

## Live comparison, November 6, 2026

Implementation commit: `1867178`. Both providers completed all 17 requests with
no retries or missing usage measurements. Jev returned model `jev-1.14.0` for
the `jev-latest` alias; Voyage returned `rerank-3`. The paired run took 2,789 ms.

| Metric | Jev 1.14.0 | Voyage rerank-3 |
| --- | ---: | ---: |
| Expected document first, modeled answerable queries | 14/15 | 14/15 |
| Expected document first, including exact-path bypass | 15/16 | 15/16 |
| Labeled evidence passage in top three | 13/15 | 12/15 |
| Selected passage bytes, answerable queries | 37,408 | 39,468 |
| Provider-reported input tokens | 50,823 | 30,680 |
| Provider-reported output tokens | 2,088 | Not reported |
| Median request time | 83 ms | 127 ms |
| p95 request time | 413 ms | 361 ms |
| Total request bytes | 181,930 | 124,052 |

Jev has a one-case evidence advantage on this small author-labeled set. Both
rerankers place the expected document first more often than the previous
embedding baseline (14/16 including the bypass). Embeddings alone already
returned labeled evidence in 13/15 cases and exposed 35,583 passage bytes, so
neither reranker improves its total evidence score. Jev has the lower median
latency while Voyage has the lower p95 in this single run. These provider token
counts do not establish relative dollar costs.

Three cases explain the evidence misses:

- **Download without filling the prompt:** both selected a relevant source-transfer
  passage at offset 2100 instead of the labeled passage at offset 3192 containing
  “Only the receipt reaches the model.” The strict anchor metric counts this as
  a miss even though the selected passage discusses materialization.
- **Missing cached-input count:** the labeled Gemini passage was absent from the
  frozen candidate pool. Both failed; this is a candidate-retrieval limitation.
  The pool's evidence ceiling is 14/15.
- **Uncommitted provider settings in new worktrees:** Jev selected the
  `NATIVE_SETUP.md` passage at offset 1385 containing “Tracked configuration comes
  from Git.” Voyage selected the later passage at offset 2100 and missed that
  anchor, although another selected Gemini passage contains relevant explanation.

The two no-answer diagnostics retain all raw scores. No threshold was fitted
and the scores are not comparable across providers. This run does not establish
a general winner or justify adding reranking to every retrieval; a held-out
evaluation should test whether its incremental benefit exceeds its extra calls.

Evidence identifiers:

- Source embedding report SHA-256:
  `542a764114acff5a743dfb3a6e3dc30af526a2d99367bf768506855508bf9b6b`
- Full reranking report SHA-256:
  `0d7102774385d43d56bd7980ec330a61dce07dbf1efbadc184fe1d4c61a5a400`
- Full report: ignored local `output/rerank-trial/report.json`; available from
  **Download report** in the trial page. It retains per-query candidates,
  source hashes, raw judgments, usage and timings.

Validation: 14 focused trial tests passed, JavaScript checks passed for 267
files, and the completed page was checked in light and dark mode with no browser
console errors. Production retrieval and running agents were not changed.
