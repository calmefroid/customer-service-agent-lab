# Deterministic Mock RAG

The knowledge module deliberately uses no vector database. Retrieval is stable and explainable:

1. Normalize the query and generate words plus Chinese bigrams.
2. Score title (28%), typical questions (30%), answer (14%), tags (20%), and scope text (8%).
3. Keep candidates scoring at least `0.22`, then filter by published state, product/category, channel, region, and effective time.
4. Return `expired` when relevant candidates are unavailable only because of their effective window, `no_hit` for all other empty outcomes, and `conflict` when same-topic high-score candidates contain contradictory facts.
5. On `conflict`, select no article. On `hit`, adopt only the highest eligible candidate and emit its article ID, version, reason, and citation excerpt.

Preview mode may include the currently selected working copy. Published mode only receives immutable published snapshots, so saving an edit cannot change consumer retrieval before publishing.

## Fixed Evals sandbox scenarios

`sandbox-scenarios.ts` exports isolated `knowledge_conflict` and `knowledge_expired` fixtures. They use a fixed effective clock and never join the default article index. The adapter's `knowledgeSandbox.activate(...)` is the only stateful trigger; `knowledgeSandbox.clear()` or `resetKnowledgeStore()` restores default behavior. The fixed-Evals runner must activate a scenario before orchestration and clear it in `finally`.
