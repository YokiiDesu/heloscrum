# Contextual embedding retrieval trial

Run `node scripts/voyage-memory-trial.mjs` and open the printed localhost URL.
Paste a Voyage key into the masked field and select **Run comparison**. The key
is held only in that process, never written to the report, browser storage, logs,
or HeloScrum configuration. **Clear key** removes its retained reference. Stop
the server to discard the in-memory index as well. No live agents are restarted.

This is an isolated trial, not enabled production Memory search. It sends only
the eight allowlisted repository documentation files and evaluation queries to
Voyage. It never opens the live `.heloscrum` database or peer notebooks. Adding
an authorized production index is a separate integration step if evaluation
supports it. Downloading a source or building an index does not record an agent
as having read it.

The current [Voyage guide](https://docs.voyageai.com/docs/contextualized-chunk-embeddings)
recommends `voyage-context-4`; the older REST reference still names context-3.
The trial explicitly requests context-4, 512 float dimensions, document/query
input types, and original ordered chunks grouped per document. It does not
silently switch models. Each result retains the complete source SHA-256 and exact
UTF-16 range; only the allowlisted snapshot is searched. Chunking is deterministic
and non-overlapping. Documents are re-embedded as a whole when the snapshot changes.

Bounds: at most 12 API calls and 120,000 UTF-8 input bytes per run; at most 28,000
input bytes per request; 30-second request timeout; 4 MiB response ceiling. There
are no automatic retries. Eight document requests and one batched query request
normally leave three additional queries. Repeated queries reuse their vector.
These are byte/request limits, not a price guarantee. The service's measured token
usage is retained; unknown usage stays unknown, including interrupted requests.

## Comparison

Eighteen fixed author-labeled queries are defined before inference: fifteen with
an exact evidence anchor, one exact reference, and two unanswerable diagnostics.
Keyword retrieval invokes the actual `WorkingMemory.search` with these documents
as shared notes and `ranking: local`. It therefore retains the production keyword
scoring and sliding windows. Contextual retrieval ranks non-overlapping chunks
and takes the best passage from each document. Hybrid retrieval combines document
ranks by reciprocal-rank fusion (equal weights, constant 60), pinning exact
references. When the excerpts differ it retains both and charges both to exposed
bytes; this extra evidence budget must be considered when interpreting results.

The report distinguishes correct-document retrieval from an exact evidence
anchor within the returned passage, using top-three results. It records per-query
rankings/similarities, source hashes/ranges, full request hashes, input/output
bytes, token usage, and elapsed times, with index construction included. Labels
are not transmitted to Voyage. Similarity and fusion scores are not probabilities.
No score threshold claims an answer exists: inspect the negative cases.

This small test can reveal retrieval regressions and whether paraphrases improve.
It cannot establish code-review quality, statistically calibrated thresholds,
or generalization to private working histories. Those require a held-out corpus
and a matched review on the same source change. Jev inference and its existing
probability/threshold policy are unchanged. A future candidate-retrieval layer
could feed Jev's existing reranker, with authorization before indexing and again
before returning current-version evidence.

Results are saved to ignored `output/voyage-trial/report.json`. The browser shows
the measured comparison and lets the user inspect passages or try extra questions.
