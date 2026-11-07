# TypeSafe and Jev

Use the installed `typesafe-ai` skill only when implementing, changing, or evaluating Jev/TypeSafe-specific behavior, including its decision questions and calibration. Read its current live documentation and the relevant question/cookbook guidance for that work. The skill is installed for Codex under `~/.agents/skills/typesafe-ai/SKILL.md`.

General embeddings, retrieval, reranking, and context-management work does not require this skill or a Jev connection. Consult the documentation for the provider actually in use.

Keep deterministic limits and execution in code. Evaluate decision questions, supplied state, probability handling, and thresholds against representative project cases; distinguish missing evidence, model errors, integration errors, and service failures. Preserve raw judgments and measured usage. A confidence value is not the probability that the entire workflow is correct.
