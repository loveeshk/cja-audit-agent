# Design documents

These four documents are the design write-ups produced at the checkpoints of a course project. They explain
the reasoning behind the code. They use the labels "Module 1" to "Module 6" for the course checkpoints:

| File | Checkpoint | What it covers | Built or designed |
|---|---|---|---|
| [`01-retrieval-design.md`](01-retrieval-design.md) | Module 3 | Why retrieval, chunking, hybrid search, threshold gate, failure modes | **Built.** Measured results are in `examples/retrieval-results.md` (regenerate with `npm run rag:report`) |
| [`02-tree-of-thoughts-design.md`](02-tree-of-thoughts-design.md) | Module 4 | Where Tree of Thoughts is needed, structure, scoring and pruning, beam search, role mapping | **Designed, not built** |
| [`03-multi-agent-design.md`](03-multi-agent-design.md) | Module 5 | Four LLM agents plus a code probe runner and a deterministic coordinator, coordination and communication | **Designed, not built** |
| [`04-safety-and-oversight.md`](04-safety-and-oversight.md) | Module 6 | Risk register, guardrails, metrics, human intervention tiers, trade-offs | Guardrails marked Built are implemented and tested |

Also here: [`architecture.png`](architecture.png) (the final architecture; source in `architecture.svg`).

Where a document says "Proposed", it is not implemented in this repository. The code and its tests are the
authority on what is built.
