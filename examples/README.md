# Sample inputs and outputs

All files here are produced by the tool's real code on its built-in **SAMPLE data**, which contains deliberate
problems. None of it comes from a real Adobe environment.

| File | What it is |
|---|---|
| `sample-audit-run.json` | Response of `POST /api/audit/run` for the sample data view: findings, severities, evidence, skipped checks |
| `sample-feed-plan.input.json` | A planned data feed with deliberate mistakes (a typo, a time dimension, a User Agent and Browser conflict, and more) |
| `sample-feed-plan.output.json` | Response of `POST /api/audit/feed-plan` for that plan: per-column status and findings |
| `sample-report.md` | The downloadable Markdown report for both of the above |
| `retrieval-traces-semantic-baseline.md` | Two real retrieval traces from the author's machine (the "before" measurements, semantic search only) |
| `mutation-results.md` | Mutation check: 13 bugs injected one at a time into checks and guardrails, and whether the tests caught each. Regenerate with `npm run eval:mutations` |
| `retrieval-results.md` | Full retrieval evaluation with the real embedding model, after the keyword channel was added: semantic vs keyword vs hybrid, weight sweep, threshold report, and the Q1 and Q2 traces. Regenerate with `npm run rag:report` |

Regenerate the first four with the sample data source: they are deterministic apart from the report's timestamp.
