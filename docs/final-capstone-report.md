# Final Capstone Report

Agentic AI Program: Building Autonomous Systems for Real-World Applications

## 1. Project title

**CJA Audit Agent: a read-only, evidence-grounded assistant for auditing and troubleshooting Adobe Customer Journey Analytics connections, data views and data feeds**

## 2. Problem and user

**The problem.** Adobe Customer Journey Analytics (CJA) only produces trustworthy reports and exports when a chain of dependent pieces is set up correctly: the connection and its datasets, the data view built on top of it, and a data feed built on the data view. Failures cross those layers. An empty or incomplete feed can come from a dataset that stopped importing new data, a component that contains no data, a time zone, a person ID that does not line up between datasets, or the feed's own dates and column choices. The evidence for each of these sits in a different place: API responses, the CJA interface, and documentation that changes and, for data feeds, was labelled Limited Testing when checked.

Today an engineer diagnoses this by hand, moving between the interface, API calls and documentation. A single problem can take hours, and a wrong fix is costly because connection settings affect how much data is brought into CJA.

**The intended users** are analytics engineers, data engineers and implementation consultants who set up, maintain or inherit CJA environments, especially those new to the connection, data view and data feed setup.

**Why it matters.** Wrong or missing data silently undermines every report and downstream export built on it. A tool that finds problems quickly, explains them with sources, and is honest about what it could not check saves time and reduces the chance of a harmful change.

**Why a prompt alone is not enough.** A language model on its own cannot see the user's actual setup, cannot verify whether a fix worked, may state outdated or invented product details, and has no record of what has already been checked. The problem needs access to live configuration, exact rule checking, current documentation and a trail of evidence.

## 3. System goal and scope

**Goal.** Help a person understand what is wrong, or might go wrong, in a CJA setup, by running exact read-only checks, validating a planned data feed against Adobe's published rules, and explaining the findings with citations from retrieved documentation. The system advises. A person decides and acts.

**What the system does**

- Audits a data view and its connection with deterministic checks, each with a severity, evidence and a next step.
- Validates a planned data feed: every requested column is resolved against the data view (with "did you mean" suggestions) and checked against feed rules, dates, lookback, processing delay and compression.
- Explains the high and medium findings with citations to retrieved notes.
- Answers documentation questions, and says so plainly when the notes do not cover the question.
- Produces a downloadable report.
- Shows, in a status strip on every page, how it is running (sample or live data, Claude or copy-prompt answers, retrieval size, login, feed creation), and shows the scores behind every retrieval in a "why these sources" inspector.

**What successful performance looks like**

1. Every deliberately seeded fault in the sample data is reported, and healthy data produces no high or medium finding.
2. Every statement about how CJA behaves carries a citation to a retrieved source.
3. When the notes do not cover a question, the system says so and does not guess.
4. Nothing in Adobe is changed without an explicit, recorded approval.
5. Anything the system could not check is listed, so a clean result is never mistaken for a complete one.

**Boundaries and constraints**

| In scope | Out of scope |
|---|---|
| Read-only audit of CJA connections, data views and components | Automatically fixing a setup |
| Validating a planned data feed | Reading existing CJA data feeds (no public API for them was found) |
| Cited explanations and documentation Q&A | Products other than CJA, and Adobe Analytics beyond the classic feed tab |
| Sample data for demonstration and tests | Production-scale or multi-tenant operation |

Constraints: the audit never writes; the single action that changes Adobe (creating a classic data feed) is guarded; the language model only explains and never creates findings; the data feed documentation was in Limited Testing, so the rules and notes record when they were checked.

## 4. Final system architecture

![Final architecture](architecture.png)

**How the parts work together.** A browser UI sends a request to an Express server. The server routes it to one of three flows:

1. **Audit.** The CJA client (GET requests only) loads the data view, its components and its connection, or uses built-in sample data. Deterministic checks produce findings. Fields Adobe did not return cause the related check to be skipped and listed.
2. **Planned feed check.** The same data feeds a validator driven by `feed-rules.json`, which holds Adobe's published rules as data.
3. **Explain or ask.** Retrieval finds the relevant sections of `knowledge.md`. The answer layer gives the model only the findings and numbered excerpts, and the model cites them. If nothing passes the threshold, the model is not called. With no API key, nothing is generated: Ask the docs quotes the best-matching note sections word for word, and Explain findings quotes the note retrieved for each high and medium finding, both with their sources. Both flows also return the exact prompt for manual use.

**Retrieval.** `knowledge.md` is split at its headings into 53 chunks (average 63 words). Each chunk and each question is embedded locally with `all-MiniLM-L6-v2`. Ranking combines cosine similarity, a BM25 keyword score and a small boost for exact identifiers. The "not covered" gate uses semantic similarity only, so generic keyword overlap cannot make an unrelated question look covered.

**How the course concepts appear in the system**

| Concept | In the system | Status |
|---|---|---|
| Reasoning loop | Observe (load setup) → verify (checks) → retrieve → advise (explanation) → record (report and traces). The branch-and-evaluate step is the Tree of Thoughts design below | Linear pipeline built; search designed |
| Memory | Short term: per-request state and the Ask conversation history. Long term: the cached embedding index and the logs. A knowledge table of past fixes is designed | Partly built |
| Tools | CJA API (GET), retrieval, the Claude API, and one guarded write | Built |
| Retrieval | Hybrid retrieval with a meaning-only gate and source display | Built, tested |
| Tree of Thoughts | Beam search over root-cause hypotheses: breadth 4/2/2, beam 2, depth 3. Evidence from probes outweighs the critic (weights 0.5, 0.2, 0.3). Branches are discarded only when a probe contradicts them | Designed, not built |
| Multi-agent | Four LLM agents (triage, generator, critic, reporter), a code probe runner and a deterministic coordinator using typed messages over shared state. Adopted only if it beats a single-agent baseline | Designed, not built |
| Guardrails, logging, evaluation, human intervention | See sections 7 and 8 | Built (with proposed additions) |

**Key design choices.** Findings come from code, not from the model. The model sees evidence and excerpts and cannot add findings. Refusing is preferred to guessing. One guarded write, everything else read-only.

## 5. Design evolution across the program

| Module | What I did | Important change and why it helped |
|---|---|---|
| **1. Capstone checkpoint** | Defined the problem, why a prompt is not enough, the environment, the actions and the feedback loop. Started from a job-application agent as a worked example, then moved to the project I actually needed: setting up and debugging Adobe Experience Platform and CJA data feeds | Chose a problem with real tools, real state and real consequences. Later learned that existing CJA data feeds cannot be read through an API, so the goal shifted from "create the feed" to "audit and validate a plan" |
| **2. Refined agent** | Added the reasoning loop (observe, plan, branch and evaluate, act, verify, update), memory, tool use against model limitations, and the justification versus a prompt-only approach. Added Tree of Thoughts for diagnosis | Gave each capability a reason tied to reliability, and made the tool read-only by default |
| **3. Retrieval** | My starting tool was an implementation-spec search that put the whole document in every prompt. I added retrieval to it, then replaced it with the CJA audit tool and real retrieval: heading-aware chunks, local embeddings, a meaning-only refusal gate and visible sources. My own traces showed a miss (the section that answers "which columns cannot be included" was not in the top 8), so I added a BM25 keyword channel and removed an introduction chunk that matched everything | Retrieval was measured and corrected instead of assumed to work. Semantic search alone put the correct section in the top 4 for 15 of 18 evaluation questions; hybrid search at the chosen weight does so for 18 of 18 |
| **4. Tree of Thoughts** | Designed where search is needed (diagnosing a symptom), the thought structure, scoring that weights evidence above opinion, pruning, parked branches, and beam search | A design that protects against premature pruning and weak scoring, with an honest evaluation plan |
| **5. Multi-agent** | Designed four LLM agents, a code probe runner and a deterministic coordinator, with typed messages, least-privilege tool access and a degradation ladder | Used agents only where judgment and independence add reliability, and kept exact work in code |
| **6. Safety and oversight** | Wrote a risk register, guardrails, metrics and human-intervention tiers. The review found that the classic feed tab could create a feed in Adobe with one click | Added a guarded write (off by default, confirmation, audit log), a write-inventory test and a startup warning. The review changed the code, not only the document |

**Most important refinements:** moving every fact into deterministic code and keeping the model for explanation; measuring retrieval, fixing a real miss, and choosing the keyword weight from a sweep rather than by guess; and letting the safety review find and close a real write path.

**What did not change.** Tree of Thoughts and the multi-agent coordination remain designs. I chose to build the parts that can be verified (checks, retrieval, guardrails) first, and to adopt search and multiple agents only if they beat a simpler baseline on the diagnosis scenarios.

## 6. Implementation overview

| Layer | Technology | Role |
|---|---|---|
| Application | Node.js 18+, Express | Server, routes, validation, optional Adobe SSO login |
| Language model | Claude through the Anthropic SDK (`@anthropic-ai/sdk`); model set by `CLAUDE_MODEL` | Cited explanations and Q&A only |
| Embeddings | `@xenova/transformers`, model `Xenova/all-MiniLM-L6-v2`, run locally | Semantic retrieval with no per-call cost, and the notes stay on the server |
| Keyword search | Custom BM25 with light stemming and stop words | Exact-wording match that embeddings blur |
| Adobe APIs | CJA API (connections, data views, dimensions, metrics, reporting) with OAuth Server-to-Server; Adobe IMS OAuth for optional sign-in; Analytics Data Feed API for the classic tab | Reading the setup (GET only for the audit) |
| Testing | Node's built-in test runner; Playwright for a one-off browser check (not in the repository) | 77 automated tests |
| Not used in the current build | CrewAI, LangChain, MCP | Part of the proposed next increment |

**Code size:** about 2,900 lines of application and script code and about 800 lines of tests, in the structure described in the README.

**Key implementation points**

- The CJA client requests optional fields through Adobe's `expansion` parameter and retries with a smaller list if Adobe rejects one. A check whose field is missing is skipped and listed.
- Adobe's published data feed rules live in `audit/feed-rules.json`, with the page they came from and the date they were checked.
- Hybrid scoring: semantic similarity + 0.5 × keyword score + a boost for exact identifiers. The refusal threshold is applied to semantic similarity.
- With no API key the app returns the full prompt, including the retrieved excerpts, for pasting into a chat. If the embedding index is unavailable it answers from the full notes and says so.
- Evaluation scripts (`rag:eval`, `rag:table`, `rag:report`, `rag:compare`, `rag:prompts`) produce the retrieval evidence. `npm run rag:report` writes all retrieval measurements to `examples/retrieval-results.md`.

**Development note.** Code and documentation were developed with assistance from an AI assistant (Claude) and verified by running the automated tests and the application locally.

## 7. Evaluation and results

**How the system was evaluated**

| Method | What it checks |
|---|---|
| 77 automated tests | Audit checks against seeded faults and healthy data; feed rules and dates; chunking; retrieval and the keyword channel; the "not covered" gate; no-key mode; credential guards; write guards; public demo lockdown |
| Deliberate defects | Eleven bugs were introduced on purpose into checks and guardrails to confirm that a test fails for each |
| Browser run | The real page was driven in headless Chromium against the real route handlers on sample data |
| Retrieval measurements | Real similarity traces on the author's machine; hit@k and MRR on 18 questions; a threshold analysis |

**Results measured**

| Result | Detail |
|---|---|
| Tests | 77 of 77 pass (audit 28, chunker 11, pipeline 11, UI support 10, keyword 7, write guards 6, public demo 3, credentials 1) |
| Seeded faults | Every fault seeded in the sample data is reported. The sample audit returns 18 findings (2 high, 5 medium, 5 low, 6 info). A healthy fixture returns none above low |
| Deliberate defects | 11 of 11 caught by a failing test |
| Browser run | Audit, feed check, explanation, report download, Ask, the status strip, the retrieval inspector and the Report Builder round trip work, with no page errors. The feed-creation confirmation behaves correctly: cancelling sent 0 requests and accepting sent 1. The run caught and fixed one real bug (the new Report Builder link broke tab switching) |
| Retrieval baseline (semantic only, real model) | **Q1** "Which columns cannot be included in a CJA data feed?": the answering section was not among the 8 candidates, and all 8 scored between 0.537 and 0.626. **Q2** "Can CJA data feeds be delivered over SFTP?": the correct section ranked first, but only 0.008 ahead of second place. Traces: `examples/retrieval-traces-semantic-baseline.md` |
| Keyword channel alone, 18 questions (offline, deterministic) | Correct section in the top 4 for 18/18 and first for 13/18 (MRR 0.843). For Q1 it ranks the answering section third |

**Retrieval with the real embedding model, after adding the keyword channel** (`npm run rag:report`; full unedited output in `examples/retrieval-results.md`)

| Setting | hit@1 | hit@4 | hit@8 | MRR |
|---|---|---|---|---|
| Semantic only | 9/18 | 15/18 | 16/18 | 0.684 |
| Keyword only | 13/18 | 18/18 | 18/18 | 0.843 |
| Hybrid, initial weight 0.3 | 13/18 | 17/18 | 18/18 | 0.833 |
| **Hybrid, chosen weight 0.5** | **14/18** | **18/18** | **18/18** | **0.866** |

The system passes the top 4 chunks to the model, so hit@4 is the number that matters most. Semantic search alone missed the correct section in the top 4 for 3 of 18 questions. The worst was Q1 ("Which columns cannot be included in a CJA data feed?"), where the answering section ranked 18th.

**Choosing the keyword weight.** The sweep over weights 0 to 1 rises steadily up to 0.4, then stays flat at MRR 0.866 and 18/18 in the top 4 from 0.4 to 0.75. The highest single value (MRR 0.870 at weight 1.0) is a one-question difference, and that weight would let keyword matching dominate. With only 18 questions I chose **0.5**, the middle of the flat region, and made it the default. The initial value of 0.3 was not enough: Q1's answering section moved from 18th to only 6th, so it would still not have reached the model. At 0.5 it is in the top 4 and is passed to the model.

**The refusal threshold.** The "not covered" gate uses semantic similarity only. On this set the two groups overlap: the lowest score of a correct section was 0.245, and the highest score of an out-of-scope question was 0.38 (an Adobe Target question that matched the API credentials section). No single threshold separates them. I kept **0.30**. At that value, 3 of 5 out-of-scope questions are refused and 1 of 18 in-scope questions would be wrongly refused. Lowering it to 0.24 would recover that one question on this set, but tuning to a single result in 18 questions would be overfitting, and it would refuse no additional out-of-scope questions. The two out-of-scope questions that pass the gate (Adobe Target, 0.38; calculated metrics, 0.317) reach the model with unrelated excerpts. The only remaining protection is the prompt instruction to answer only from the excerpts, which has not been measured.

**Limitations of this evaluation.** The 18 questions are a small set written by the project author, so they show that retrieval finds the right section, not how it behaves on unanticipated questions. The live Adobe client has not been run against a real environment, so precision on real data is unknown. The quality of the model's written explanations was not measured, because no API key was available. The Tree of Thoughts and multi-agent designs have not been evaluated, and their scenarios are written down for a future run.

**Main findings.** Exact, deterministic checks gave repeatable and testable results. Embedding search alone missed a direct question, which measurement revealed and a keyword channel addressed: hit@4 rose from 15/18 to 18/18 and MRR from 0.684 to 0.866. The measurements also showed that the first keyword weight I picked was too low, and that the refusal threshold cannot fully separate on-topic from off-topic questions. The safety review found a real write path that is now guarded. The system is trustworthy where it is tested, and the report states where it is not.

## 8. Safety and reliability considerations

**Guardrails (prevent)**

- The audit makes only GET requests, and a test fails if a write verb appears in its client.
- The one write, creating a classic data feed, is off by default (`ALLOW_FEED_CREATION`), needs an explicit confirmation that the server checks again, and shows the exact feed before sending.
- A write-inventory test lists every non-GET call in the code, so a new write fails the build until it is reviewed.
- The model may use only the findings and numbered excerpts, cannot add findings, and receives only high and medium findings.
- When no chunk passes a threshold on meaning, the model is not called and the user is told the notes do not cover the question.
- Text from the environment (component names, error strings) is treated as data: whitelisted fields, truncation, and an instruction to ignore embedded instructions.
- With login off, the server binds to localhost and refuses cross-origin requests. The hosted demo is the only exception: `PUBLIC_DEMO=true` first removes every Adobe credential and the Anthropic key, forces sample data and keeps feed creation off, and a test starts the server with credentials planted to confirm that none of them can be used.

**Monitoring and checking**

- `logs/write-audit.jsonl` records every attempt to create a feed (who, what, outcome, never credentials).
- `logs/rag-traces.jsonl` records questions, retrieved chunks, scores, outcome and token use.
- Skipped checks are always listed. Sample data is labelled on screen and in the report. Sources are shown with every answer.
- Startup warnings cover login off, no API key, and feed creation enabled while login is off.

**Fallback logic**

| Condition | Behaviour |
|---|---|
| Embedding index unavailable | Answer from the full notes and say so |
| No API key | Ask the docs and Explain findings quote the retrieved note sections verbatim with sources (per finding for Explain); both also return the exact prompt for manual use |
| Adobe does not return a field | Skip that check and list it |
| Nothing relevant retrieved | Say the notes do not cover it, with no model call |
| Connection not readable | Run the data view checks and report the connection as unreadable |

**Human oversight.** The default is deny. Approval is required before any change to Adobe (enforced in code for the one write). Findings that imply a production change, answers that say "not covered", skipped checks and weak retrieval require review before anyone relies on them. Suspected prompt injection, repeated denied writes or credential errors, and metrics falling below target are escalated. The operator can stop everything by turning feed creation off, forcing sample data or removing the API key. The risk register, metrics and trade-offs are in `docs/04-safety-and-oversight.md`.

## 9. Limitations and next steps

**Current limitations**

- Existing CJA data feeds cannot be seen, because no public API was found, so only planned feeds are validated.
- The live Adobe client follows the published documentation and is tested against fake responses, but has not been run against a real environment. Some response shapes are not fully documented, and the audit skips rather than guesses.
- The data feed documentation was labelled Limited Testing, and the notes are my paraphrase. The rules and notes need re-checking whenever Adobe's pages change.
- The evaluation set is small (18 in-scope and 5 out-of-scope questions) and written by the author. The keyword weight and threshold were chosen from it, and should be re-checked on a larger set.
- The refusal threshold does not cleanly separate on-topic and off-topic questions: at 0.30, 2 of 5 off-topic questions pass the gate and 1 of 18 on-topic questions would be refused.
- Tree of Thoughts, multi-agent coordination and an MCP server are designs only.
- Login is off by default for easy local use, so the app must not be exposed on a network in that state.
- Logs contain user questions and need a retention limit.

**Realistic next steps, in order**

1. Run the audit against a real CJA environment and review the skipped-check list.
2. Strengthen the "not covered" decision, since the threshold alone lets 2 of 5 off-topic questions through: add a reranker or a second relevance check, and grow the evaluation set with real questions from engineers, including more out-of-scope ones.
3. Add a prompt-injection test set and an automatic citation check, then record timing in the traces.
4. Implement the Tree of Thoughts roles in the existing Node code and run the six diagnosis scenarios against a single-chain baseline.
5. Adopt multiple agents, an MCP server and CrewAI or LangChain only if the scenario results justify the extra complexity.
6. Add alerts for denied writes, repeated 401 or 403 errors and cost spikes, and a stale-rules warning.

## 10. Public GitHub repository

**Repository:** [https://github.com/loveeshk/cja-audit-agent](https://github.com/loveeshk/cja-audit-agent)

**Live demo:** [https://cja-audit-agent.onrender.com](https://cja-audit-agent.onrender.com). This is a public, read-only deployment on Render in demo mode: sample data only, with Adobe access, feed creation and the Claude API switched off on the server. On the free plan it sleeps when idle, so the first visit can take about a minute.

**What it contains**

| Required element | Where |
|---|---|
| README explaining the project, problem, architecture, setup and usage | `README.md` |
| Main code | `server.js`, `core.js`, `rag.js`, `audit/`, `public/`, `scripts/`, `test/` |
| Sample inputs, outputs and evaluation artifacts | `examples/` (sample audit, feed plan, report, real baseline retrieval traces) and `eval/questions.json` |
| Instructions for running and reviewing | `README.md`, "Quick start for reviewers" |
| Design write-ups | `docs/` (retrieval, Tree of Thoughts, multi-agent, safety, and this report) |

**How to review it in a few minutes, with no accounts or keys**

1. Download or `git clone` the repository. On Windows, double-click `start.bat` (or run `./start.sh` on macOS or Linux), which installs, starts and opens the browser. Or from a terminal: `npm install`, then `npm start`, then open `http://localhost:3000`.
2. `npm test` runs the 77 offline tests.
3. Open the page. The audit runs on labelled sample data. Click **Run audit**, then use **Fill with an example** and **Validate plan**.
4. Read `examples/` to see real outputs, and `docs/` for the design reasoning.
5. To see retrieval, run `npm run rag:table -- "Which columns cannot be included in a CJA data feed?"`.
