# CJA Audit Agent: project instructions

A read-only, evidence-grounded assistant that audits Adobe Customer Journey Analytics (CJA) connections, data views
and planned data feeds. Node.js + Express. Deterministic checks find problems, hybrid retrieval over `knowledge.md`
supplies cited documentation, and a language model may only explain what the checks found.

## Commands

- `npm install`, then `npm test` (77 offline tests; they use a mock embedder and a fake model client, no network)
- `npm start` then open http://localhost:3000 (or double-click `start.bat` / run `./start.sh`)
- `npm run rag:eval` retrieval accuracy and threshold report (real embedding model, no API key)
- `npm run rag:table -- "question"` retrieval trace as a paste-ready table (no API key)
- `npm run examples` regenerate `examples/` from the built-in sample data

## Where things are

- `audit/checks.js` the checks (pure functions). `audit/feed-rules.json` Adobe's feed rules as data
- `audit/cja-client.js` GET-only CJA client. `audit/mock-data.js` labelled SAMPLE data
- `rag.js` chunking, local embeddings, BM25, hybrid retrieval. `knowledge.md` the CJA notes
- `core.js` prompts, no-key mode, fallbacks. `audit/explain.js` cited explanation of findings
- `ask-routes.js`, `status.js`, `feeds-routes.js`, `cja-routes.js`, `server.js` HTTP layer. `public/` UI
- `docs/` design write-ups. `docs/final-capstone-report.md` is the final report

## Rules for changing this repository

1. **The audit is read-only.** Never add a non-GET call to `audit/`. The only write to Adobe is creating a classic
   data feed, guarded by `ALLOW_FEED_CREATION`, a confirmation and an audit log. The write-inventory test in
   `test/write-guard.test.js` must be updated deliberately if a write is ever added.
2. **Findings come from code only.** The model explains findings and excerpts and must not add findings.
3. **Never state a result that was not measured.** Evaluation numbers must come from running the commands above.
   Keep "Built" and "Designed, not built" honest. Tree of Thoughts, the multi-agent roles and an MCP server are
   designs in `docs/`, not code.
4. **Never commit secrets or private material.** No `.env`, `logs/`, `rag-index.json`, API keys, or any client or
   company specification. `archive/` must not exist in this repository.
5. **Adobe documentation:** `knowledge.md` and `audit/feed-rules.json` are paraphrases with source URLs and a check
   date. Re-check them against Adobe's pages when those change. Do not paste Adobe's text.
6. **Run `npm test` before every commit.** Add a test for any new guardrail, and check that it fails when the
   guardrail is broken.
7. `start.bat` must keep Windows (CRLF) line endings and `start.sh` Unix (LF). `.gitattributes` enforces this.

## Known limitations (do not hide these)

- Existing CJA data feeds cannot be read through the API (none was found), so only planned feeds are validated.
- The live Adobe client has not been run against a real environment; it is tested against fake responses.
- The evaluation question set (`eval/questions.json`) is small and was written by the author.
- Login is off by default for local use (server binds to 127.0.0.1). Never expose it on a network in that state.
