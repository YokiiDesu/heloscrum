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
