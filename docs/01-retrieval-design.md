# Module 3 — Retrieval architecture (CJA Audit Agent)

How to reproduce the measurements in this document (no API key needed unless noted):

```
npm install
npm test                     # 77 offline tests
npm run rag:report           # retrieval evaluation + the Q1 and Q2 traces -> examples/retrieval-results.md
npm run rag:compare          # none vs full vs rag answers (needs ANTHROPIC_API_KEY)
npm run rag:prompts          # without a key: the same three prompts, to paste into a chat
```

---

## 1. Architectural decision: is retrieval required, and why

**Decision: retrieval (RAG) is used for explaining findings and for answering documentation questions.
It is deliberately not used to decide what is wrong, and not used for the state of the user's environment.**

The tool has three kinds of knowledge, each handled differently:

| Knowledge | Where it comes from | How it is used |
|---|---|---|
| The user's actual setup (datasets, data view settings, components, ingestion status) | Live, read-only CJA API calls | Deterministic checks in code (`audit/checks.js`). Never retrieved, never guessed by a model |
| Adobe's data feed rules that can be enforced mechanically (columns that are unavailable, metrics to substitute, device-column conflicts, date and frequency rules) | `audit/feed-rules.json`, seeded from Adobe's Create a data feed page | Enforced in code, so a retrieval or model mistake cannot hide a violation |
| Why a finding matters, what to check next, how CJA and Adobe Analytics feeds differ | `knowledge.md`, retrieved | Retrieval-augmented explanation with citations, and the Ask the docs tab |

Why retrieval for the third kind:

- **The documentation is specific, changing, and easy to blur.** The feed rules contain long exact lists, differ between CJA and Adobe Analytics (for example output format, destinations, persistence models), and the pages were labelled Limited Testing when checked on 2026-10-26. A model's memory of this can be outdated or can mix the two products. Whether it actually does is measured in section 3, not assumed.
- **Each finding needs different notes.** An audit can produce a dozen findings, each needing its own explanation. Retrieving per finding supplies only the relevant notes for each one instead of the whole file.
- **Traceability.** An engineer will act on the advice in a production setup, so every statement about how CJA works must point to a source section, and every source section carries its Adobe URL.
- **The notes will grow.** More Adobe pages can be added to `knowledge.md` without changing the prompts.

An honest note on necessity: at about 3,700 words the notes still fit in the model's context window, so
sending all of them would work. Retrieval is chosen for per-finding precision, citations, and growth, and
the original full-notes behaviour is kept as `RAG_MODE=full` and as the automatic fallback. Input tokens for
full notes vs retrieved chunks were not measured, because `npm run rag:compare` needs an Anthropic API key
and none was available during the program.

## 2. Evidence that semantic retrieval is integrated with an external data source

- **External data source:** `knowledge.md`, a document outside the model made of paraphrased Adobe
  documentation (each section ends with its source URL and the date checked) plus clearly labelled
  "Audit tool note" sections that explain each finding.
- **Semantic mechanism:** chunks and queries are embedded locally with `Xenova/all-MiniLM-L6-v2` and
  ranked by cosine similarity, so a question matches by meaning ("can I get this over SFTP?" finds the
  destinations section). A small boost applies to exact identifiers that appear in few chunks
  (`parentDataGroupId`, `hasData`, and finding ids such as `conn.import-new-data-off`).
- **Keyword channel (added after measuring a miss, see section 3):** a BM25 word-matching score is added to
  the semantic score, because embeddings blur exact wording. The "not covered" gate still uses meaning only.
- **Where it runs:** `rag.js` (chunking, embeddings, index, retrieval), `audit/explain.js` (retrieves per
  finding and writes the cited explanation), `core.js` (Ask the docs, no-match handling, fallback),
  `audit/routes.js` and `server.js` (HTTP wiring).
- **Evidence:** with the current `knowledge.md` and default settings the chunker produces **53 chunks
  (average 63 words, largest 147)**; the first line of `npm run rag:eval` reports this. The live index can be
  inspected with `GET /api/rag/status`, and every answer in the UI shows its sources and a "Why these
  sources?" panel with each candidate's similarity and keyword scores.

## 3. Demonstration that retrieval grounds the output

Method: the same question is run three ways with `npm run rag:compare`: **none** (Claude with no notes),
**full** (all notes in the prompt) and **rag** (retrieved chunks only). The script saves the answers,
input token counts, and the retrieval trace.

Questions and why they were chosen:

1. *"Which columns cannot be included in a CJA data feed?"* The answer is a long exact list (time-based
   dimensions, optional standard components, several metrics) that a model can easily shorten or invent.
2. *"Can CJA data feeds be delivered over SFTP?"* Adobe Analytics feeds can use SFTP and CJA feeds list
   only S3, Azure and Google Cloud, so a model that blurs the two products may answer incorrectly.

**Status: the three-way answer comparison has not been run**, because it calls Claude and no API key was
available. The comparison script and a no-key variant (`npm run rag:prompts`) are in the repository, so the
answer-quality side of grounding is an open item (see the final report, section 9). What *was* measured is
whether retrieval finds the right notes, below.

**Baseline measured on my machine (semantic search only, 53-chunk index, threshold 0.3, before the keyword channel was added).**

Q1, *"Which columns cannot be included in a CJA data feed?"*: the section that answers it, "Columns that are
not available in a feed", was **not among the 8 candidates examined**. The four chunks returned were generic
(`Where the feed columns come from` 0.626, `What a CJA data feed is` 0.612, `Columns that are always included
in a feed` 0.582, `Prerequisites for data feeds` 0.564). All 8 candidates scored between 0.537 and 0.626, so the
embeddings were matching the general topic ("CJA data feed" appears in every section) and not the question's
specific wording. This is a retrieval miss on the first question I tried.

Q2, *"Can CJA data feeds be delivered over SFTP?"*: the correct section, `Backfill window and destinations`,
ranked first (0.551), narrowly ahead of `Prerequisites for data feeds` (0.543), which also lists destinations.
The right answer was found, but the margin between first and second place was 0.008.

**Change made:** a BM25 keyword score is added to the semantic score. Keyword channel alone, measured offline on
the 18 in-scope questions (independent of the embedding model): the correct section is in the top 4 for
**18/18** and ranked first for 13/18 (MRR 0.843). For Q1 it ranks "Columns that are not available in a feed"
third. The combined (hybrid) result depends on the
embedding scores. The full evaluation over the set in `eval/questions.json` (18 in-scope questions, including
one follow-up and one deliberately hard cross-note question, plus 5 out-of-scope questions) compares semantic,
keyword and hybrid ranking, sweeps the keyword weight, and reports the threshold. Its unedited output, with the
Q1 and Q2 traces after the change, is in [`examples/retrieval-results.md`](../examples/retrieval-results.md),
and the summary numbers are in the final report, section 7.

Summary of the measured results (18 in-scope questions, 5 out-of-scope):

| Setting | hit@1 | hit@4 | hit@8 | MRR |
|---|---|---|---|---|
| Semantic only | 9/18 | 15/18 | 16/18 | 0.684 |
| Keyword only | 13/18 | 18/18 | 18/18 | 0.843 |
| Hybrid, weight 0.3 (initial) | 13/18 | 17/18 | 18/18 | 0.833 |
| Hybrid, weight 0.5 (chosen) | 14/18 | 18/18 | 18/18 | 0.866 |

After the change, Q1's answering section ("Columns that are not available in a feed") moved from 18th (semantic
only) into the top 4 at weight 0.5. At 0.3 it was 6th and so would still not have reached the model. Q2 stays
first, and its margin over second place widened (combined 0.851 vs 0.661 at weight 0.3).

Caveats: the question set is small and written against the notes' headings, so it measures whether retrieval
finds the right section, not accuracy on questions nobody anticipated; and the offline test suite uses a stub
model and a mock embedder, so it proves the wiring, not the answer quality. Whether the cited explanations are
supported by their excerpts was not measured (no API key); an automatic citation check is a planned next step.

## 4. Key retrieval design decisions

| Decision | Choice | Reason |
|---|---|---|
| Data source | `knowledge.md`: paraphrased Adobe pages plus labelled audit tool notes | Authoritative sources with URLs, and the tool's own guidance kept separate and labelled |
| Segmentation | Split at headings; one topic per section | Each rule or setting is self-contained |
| Chunk context | Heading path stored with each chunk and prepended to the embedded text | Section titles such as "Processing delay" carry meaning the body text may not repeat |
| Chunk size | At most 180 words, 30-word overlap only when a long section must split | The embedding model was trained on inputs of about 256 word-pieces, so small chunks embed faithfully |
| Resulting index | 53 chunks, average 63 words, largest 147 (measured on the current file) | Nearly every topic is exactly one chunk |
| Embeddings | `all-MiniLM-L6-v2`, run locally | No per-call cost or extra key; notes never leave the server |
| Search | Hybrid: cosine similarity + keyword (BM25) score x weight + 0.12 for exact identifiers found in at most 6 chunks. Headings count double in the keyword index | Embeddings are weak on exact wording (measured miss in section 3); BM25 rewards rare words such as "cannot" and "SFTP"; the identifier limit stops common words distorting ranking |
| Keyword weight | `RAG_LEX_WEIGHT` = 0.5 | The sweep is flat at MRR 0.866 and 18/18 hit@4 from 0.4 to 0.75; 0.5 is the middle of that region. The peak at 1.0 (MRR 0.870) is a one-question difference and would let keywords dominate. The initial 0.3 left Q1 at rank 6 |
| Per-finding queries | Each finding carries a `kbQuery` that names its finding id and topic | A finding retrieves its own audit tool note (covered by a test) |
| Results returned | Examine 8 candidates, keep at most 4 above the threshold for Ask the docs, 2 per finding for explanations (merged, capped at 8) | Enough coverage without flooding the prompt. At weight 0.5, hit@4 equals hit@8 (18/18), so a larger k would add no correct sections on this set |
| Threshold | `RAG_MIN_SCORE` = 0.30 (kept) | The gate applies to semantic similarity only. Measured ranges overlap: lowest correct section 0.245, highest out-of-scope question 0.38. At 0.30, 3/5 out-of-scope questions are refused and 1/18 in-scope would be wrongly refused. 0.24 would recover that one question but refuse nothing more, and tuning to one question of 18 would be overfitting |
| Follow-ups | A question under 8 words is searched together with the previous question | "What about backfill feeds?" means nothing alone |
| Index cache | `rag-index.json` with a fingerprint of the file and settings | Fast restarts; editing the notes rebuilds the index |

## 5. Retrieval failure modes and how the design handles them

**Primary failure mode: stale documentation.** Adobe changes pages, and the data feed pages were labelled
Limited Testing. An index built on old notes would explain things confidently and wrongly.

Mitigations:
1. **The enforceable rules do not depend on retrieval.** Unavailable columns, substitutions, conflicts, and date, frequency, delay and compression rules live in `audit/feed-rules.json` and run as code, with the source URL, the page's last-updated date and the date checked recorded in the file. A stale index can make an explanation out of date, but cannot make the audit miss a violation that the rules file covers.
2. **Every documentation chunk ends with its source URL**, and the explanation cites chunk numbers, so a reader can open the page and confirm.
3. **Editing the notes rebuilds the index automatically** (the fingerprint includes the file contents), and the README tells maintainers to re-check the rules file and the notes whenever the Adobe page changes.

**Second failure mode: weak matches presented as answers.** Embedding search always returns the closest
chunks, even for unrelated questions, and a model given irrelevant excerpts may build an answer from them.
- A **similarity threshold** stops the model being called at all when nothing qualifies, and the user is told the notes do not cover the question.
- A **prompt-level check** tells Claude to answer only from the excerpts, say which part is not covered, and write "no documentation excerpt found" instead of filling gaps.
- Evidence, top semantic score of each out-of-scope question at threshold 0.30: ACDL video event 0.106 (refused), Adobe Target 0.38 (**not refused**), Query Service SQL 0.099 (refused), calculated metric 0.317 (**not refused**), capital of France 0.021 (refused). So **3/5 are refused**. The two that pass reach the model with unrelated excerpts, where only the prompt-level check protects the answer. This is the main open retrieval weakness.

Other failure modes handled:

| Failure mode | Handling |
|---|---|
| Embeddings match the topic but miss the question's exact wording (measured: Q1 missed the answering section) | Keyword channel added; compared semantic vs keyword vs hybrid in `npm run rag:eval`, with a weight sweep |
| The model invents findings or claims about the user's environment | Findings come only from deterministic checks. The explain prompt allows only the listed findings, and the findings are shown on screen separately from the explanation |
| A finding retrieves the wrong note | Per-finding query contains the finding id, plus the identifier boost; a test checks that `conn.import-new-data-off` retrieves its own note |
| Text from the user's environment or from documents contains instructions (for example a component named to look like a command) | Findings arriving from the browser are reduced to known fields and cut to length; evidence is passed as JSON data; the prompt says to ignore instructions inside findings and excerpts |
| A short follow-up retrieves nothing useful | The previous question is added to the retrieval query |
| The embedding model cannot load (first start offline, blocked download) | The app starts anyway, answers from the full notes, and says so in the UI |
| The API did not return a field a check needs | The check is skipped and listed under "Not checked or limited", never guessed |

**What is not solved:** a small single-file index with a hand-written evaluation set; no reranker; the
threshold must be re-tuned if the notes or embedding model change; the paraphrased notes are my reading
of Adobe's pages and should be checked against them by someone who owns the setup; and the live Adobe
client has not been run against a real environment, so which expansions Adobe accepts is still to be
confirmed on the first live run.
