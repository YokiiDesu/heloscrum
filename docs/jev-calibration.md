# Jev Context Decision Calibration

Use the installed TypeSafe skill and current
[state](https://docs.typesafe.ai/concepts/state),
[Choice](https://docs.typesafe.ai/primitives/choice), and
[confidence](https://docs.typesafe.ai/confidence) documentation when changing this policy.

## State and Policy

`context-decision.mjs` supplies bounded current task records, board revisions,
private notebook notes with freshness labels, and recent records. Other agents'
task details and notebooks are excluded. The question asks whether retaining the
conversation is useful. Code controls budgets, provider readiness, permissions,
and the reviewed handoff.

Decision audits retain the supplied state, question wording and version, raw
answers, model, and measured usage in private workspace storage. Selected-option
probability and confidence are distinct values. The confidence gate is 0.7; it
does not authorize a native-session rotation or prove an entire workflow correct.

## Bounded Evaluation

List the synthetic fixtures without making an AI call:

```sh
node scripts/evaluate-context-decisions.mjs
```

Explicit live execution uses `--live --out <directory>` and a configured Jev
connection. It compares a baseline and the current question on eight labeled
cases. The script bounds requests to eight, checks a 30,000-input-token allowance
between calls, and has a one-minute run limit. A request can exceed the remaining
allowance before its usage is returned; these are best-effort stops.

Label cases before seeing model answers. Include unfinished debugging, changed
requirements, accepted milestones, stale notes, and fresh short sessions. Compare
rule-only, baseline, and current-question decisions on identical evidence.
Measure unnecessary checkpoints, missed useful checkpoints, recall and continuation,
summary and decision overhead, and total cached and uncached input. Keep a separate
held-out set before changing thresholds. Synthetic fixture agreement alone does
not establish production quality or token savings.

Separate missing evidence, model decision errors, summary-generation errors,
integration errors, and service failures. Retain raw judgments and actual usage;
missing usage is unknown, never zero.
