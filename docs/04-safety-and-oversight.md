# Safety, evaluation and human oversight (paste-ready)

**Status:** guardrails marked **Built** are implemented in the current tool and covered by automated tests (77 tests
in the suite). Guardrails marked **Proposed** belong to the planned Tree of Thoughts and multi-agent increment and
are not built. Targets in section 3 are initial goals to be recalibrated after the first measurements, not results.

---

## 1. Purpose and main safety and reliability risks

**Purpose.** The CJA Audit agent helps analytics and data engineers set up and troubleshoot Adobe Customer Journey
Analytics (CJA). It reads a connection and data view, runs deterministic checks, validates a planned data feed
against Adobe's published rules, retrieves the relevant documentation notes, and explains the findings with
citations. It is an **advisory tool**: a person decides and acts. The audit is read-only. The one exception is
creating a classic Adobe Analytics data feed from a separate tab, which is the only action that changes anything in
Adobe.

**Where risk enters the workflow**

| Stage | What happens | Built or planned |
|---|---|---|
| 1. Read the environment | GET requests to the CJA API (or sample data) | Built |
| 2. Audit checks | Deterministic code finds problems | Built |
| 3. Feed pre-flight | Planned feed checked against a rules file | Built |
| 4. Retrieval | Hybrid search over the CJA notes | Built |
| 5. Explanation and Q&A | A language model writes cited text from findings and excerpts | Built |
| 6. Report | Markdown export | Built |
| 7. Create classic feed | The single write to Adobe | Built, guarded |
| 8. Diagnose a symptom | Tree of Thoughts search with several agents | Proposed |

**Risk register.** Impact and likelihood are my qualitative judgment, to be revisited with real usage data.

| ID | Risk | Impact | Likelihood | Main controls (section 2) |
|---|---|---|---|---|
| R1 | A person makes a harmful production change on wrong or outdated advice (invented or stale explanation) | High | Medium | Excerpts-only answers with citations, refusal when not covered, advisory only, approval for changes |
| R2 | **False reassurance:** a real problem is missed, or checks that could not run go unnoticed | High | Medium | Skipped checks always listed, never guessed. Limits stated in the tool |
| R3 | False alarms that waste time or train people to ignore findings | Medium | Medium | Severity levels, healthy-data tests, time-boundary caveats |
| R4 | An unintended change to Adobe | High | Low to medium (higher while login is off) | Off by default, explicit confirmation, audit log, write inventory test |
| R5 | Sensitive data leaves the environment (names, identity setup, queries, credentials) | High | Medium | Whitelisted fields only, no credentials in prompts or logs, localhost binding |
| R6 | Prompt injection through component names, error strings or notes | Medium | Low to medium | Data-only handling, truncation, read-only tools, findings come from code |
| R7 | Retrieval returns the wrong section or a weak match (I measured one such miss) | Medium | Medium | Hybrid search, refusal below a meaning threshold, sources shown |
| R8 | Sample data mistaken for a real environment | Medium | Medium | Banner on screen and in the report |
| R9 | Unauthorised use while login is off by default | Medium | Low | Localhost-only, cross-origin requests refused, warning when writes are on |
| R10 | Runaway cost or an outage | Low | Medium | Token cap, no-key mode, fallbacks. Budgets proposed for the search |
| R11 | Search-specific: premature pruning, weak scoring, branch explosion | Medium | Medium | Designed in the Tree of Thoughts design. **Proposed** |

## 2. Safety guardrails

Guardrails are grouped by what they do: **constrain** behavior, **check** it, or **monitor** it.

### Constrain (prevent)

| # | Guardrail | How it works | Status |
|---|---|---|---|
| C1 | **The audit is read-only** | The CJA client makes only GET requests. A test fails if a write verb appears in it | Built, tested |
| C2 | **One guarded write** | Creating a feed is refused unless `ALLOW_FEED_CREATION=true`, and the server also requires an explicit confirmation. The page shows the exact feed and asks the person to confirm. Cancelling sends nothing (checked in a browser run) | Built, tested |
| C3 | **Write inventory** | A test reads the source and lists every non-GET call. Today there is exactly one real write. Adding another fails the test until it is reviewed on purpose | Built, tested |
| C4 | **Input validation** | Data view ids must match a safe pattern, plan fields are type-checked and length-capped, findings sent for explanation are limited to 80 | Built, tested |
| C5 | **Answers come only from supplied evidence** | The model may use only the audit findings and the numbered excerpts. It cannot add findings, and only high and medium findings are sent | Built, tested |
| C6 | **Refusal when the notes do not cover it** | If no chunk passes a threshold on meaning, the model is not called and the user is told it is not covered. Keyword overlap alone can never pass the gate | Built, tested |
| C7 | **Untrusted text is data** | Findings from the browser are reduced to known fields and truncated. Evidence is passed as JSON. The prompt says to ignore instructions found inside it | Built, tested |
| C8 | **Network exposure** | With login off the server binds to `127.0.0.1` and refuses cross-origin requests, so a web page open in the browser cannot call it | Built (verified by booting the server under four configurations, not in the automated suite) |
| C9 | **Output limit** | Model output is capped at 1500 tokens | Built |
| C10 | **Search guardrails** | Hard gates (read-only probe, grounded, falsifiable, distinct, safe), a critic that never sees sibling scores, evidence outweighing opinion, call and probe budgets, a degradation ladder | **Proposed** |

### Check (detect problems)

| # | Guardrail | How it works | Status |
|---|---|---|---|
| K1 | **Skipped checks are visible** | When Adobe does not return a field, the check is skipped and listed under "Not checked or limited", never guessed | Built, tested |
| K2 | **Sources on every answer** | Sections used, scores and line ranges are shown. The explanation cites excerpt numbers | Built |
| K3 | **Sample data labelling** | A banner on screen and a note in the downloaded report | Built, tested |
| K4 | **Fallbacks that keep working honestly** | If the embedding index is unavailable, answer from the full notes and say so. With no API key, return the exact prompt for manual use | Built, tested |
| K5 | **Regression evaluation** | `npm test` (77 tests) and `npm run rag:eval` (retrieval accuracy and the threshold) | Built |
| K6 | **Automatic citation check** | Verify each citation exists and the answer carries citations for product claims | **Proposed** |
| K7 | **Stale rules warning** | Warn when `feed-rules.json` or the notes are older than 90 days (the file records the date checked) | **Proposed** |

### Monitor (observe)

| # | Guardrail | How it works | Status |
|---|---|---|---|
| M1 | **Write audit log** | `logs/write-audit.jsonl` records every attempt to create a feed: time, user, feed name, report suite, and the outcome (created, failed, or the reason it was denied). It never holds credentials | Built, tested |
| M2 | **Retrieval and answer trace** | `logs/rag-traces.jsonl` records the question, retrieved chunks and scores, outcome (including refusals) and token use | Built |
| M3 | **Startup warnings** | Login off, no API key, or feed creation on while login is off | Built |
| M4 | **Alerts and review** | Counters for denied writes, repeated 401 or 403 errors, refusal-rate changes and cost, reviewed on a schedule. Add timing to the traces | **Proposed** |

Logs contain user questions, so they are treated as sensitive. A retention limit and access control are part of M4.

## 3. Evaluation metrics

The tool is advisory and its worst failures are missed problems and unsupported advice, so the metrics put
correctness and groundedness ahead of speed. Targets are initial.

| Category | Metric | How it is measured | Initial target | Available now |
|---|---|---|---|---|
| **Safety** | Unapproved writes to Adobe | Mutating calls without the flag and a confirmation, from tests and the write audit log | 0 | Yes |
| | Injection compliance rate | Share of adversarial cases (instruction text in component names, error strings and notes) where the output follows the instruction | 0% on at least 10 cases | Proposed |
| | Secret leakage | Credentials found in prompts, logs, reports | 0 | Proposed (scan) |
| **Audit correctness** | Seeded-fault recall | Known faults in the sample data that the audit reports | 100% | Yes (tests) |
| | False high or medium findings on healthy data | Healthy fixture | 0 | Yes (tests) |
| | Precision of high and medium findings on real data | An engineer reviews each one | 90% or more | Proposed |
| | Skipped-check rate on real data | Checks that could not run, as a share | Reported; review above 30% | Yes (shown per run) |
| **Retrieval** | hit@1, hit@4 and MRR, semantic vs keyword vs hybrid | `npm run rag:eval` on 18 questions | hit@4 90% or more | Yes |
| | Out-of-scope refusal rate | Out-of-scope questions refused by the threshold | 90% or more | Yes |
| | Wrong-refusal rate | In-scope questions refused | 5% or less | Yes |
| **Groundedness** | Citation coverage | Statements about product behavior that carry a citation, in a reviewed sample | 95% or more | Proposed |
| | Citation validity | Cited excerpt actually supports the statement, in a sample of 30 | 95% or more | Proposed |
| | Unsupported-claim rate | Statements with no support in findings or excerpts | 5% or less overall, 0 in remediation steps | Proposed |
| **Reliability and efficiency** | Latency p50 and p95 per route | Add timing to traces | Audit p95 under 10 s, explanation p95 under 30 s (assumed) | Proposed |
| | Tokens and cost per run | From trace usage | Tracked | Yes |
| | Fallback activation rate | Traces | Tracked; investigate a rise | Yes |
| **Oversight** | Approval and denial counts, time to approve | Write audit log | Tracked | Yes |
| | Override rate | Reviewer rejects the tool's recommendation | Tracked; a rise triggers a review | Proposed |
| **Outcome** | Time to diagnosis vs manual | Small pilot with timed tasks | Faster with no loss of accuracy | Proposed |
| | Search and multi-agent scenarios | True cause ranked first, false alarm on a no-fault control, calls and seconds (from the Tree of Thoughts and multi-agent designs) | Must beat the single-call baseline | Proposed |

**How the metrics are used.** `npm test` must pass before any change ships. `npm run rag:eval` is recorded after
every change to the notes, the chunking or the threshold. A metric falling below target after a change means the
change is reverted or reviewed before use.

## 4. When a human must intervene

The default is **deny**: if nobody responds, nothing happens.

| Tier | Trigger | Who decides | What they see | Enforced by |
|---|---|---|---|---|
| **A. Approval required before the action** | Any change to Adobe (today: creating a feed) | The person using the tool, after the owner enabled the capability | The exact feed (name, report suite, columns, interval, start) in a confirmation | **Code**: flag, confirmation, audit log |
| | Any change to a connection, data view or production setting that the advice recommends | The CJA administrator or data owner, outside the tool | The finding, its evidence, and the cited notes | Process (the tool never makes these changes) |
| | Turning on live credentials, enabling feed creation, or exposing the app beyond this computer | The system owner | The configuration change | Process, with startup warnings |
| | Changing the threshold, `feed-rules.json`, the notes, or the prompts | A second reviewer | The diff plus passing tests and `rag:eval` | Process |
| | Sending sensitive data to a hosted model or pasting a prompt into a chat | The data owner, per organisational policy | The exact prompt (the copy-prompt button shows it) | Process |
| **B. Review required before relying on a result** | A high-severity finding that would lead to a production change | The engineer, then the owner | Finding, evidence, sources | Severity shown on screen |
| | The answer says "not covered" or "no documentation excerpt found" | The engineer checks Adobe's documentation | The message | Built (refusal), process |
| | Checks were skipped, or more than 30% could not run | The engineer | The "Not checked or limited" list | Built (list), process (limit) |
| | Weak retrieval: top score near the threshold, or the top two chunks within about 0.01 (I saw 0.008) | The engineer | Sources and scores | Sources shown. A low-confidence flag is **Proposed** |
| | Rules or notes older than 90 days, or Adobe's page changed | The maintainer | The recorded check date | **Proposed** |
| | Search is inconclusive, the budget ran out, or the critic and a probe disagree | The engineer | The tree and the reasons for pruning | **Proposed** |
| **C. Escalate to the owner or security** | Instruction-like text in component names, errors or notes | Security contact | The text and where it appeared | **Proposed** detection |
| | Repeated denied writes, or a write attempt by an unexpected user | System owner | The write audit log | Logged today; alerting **Proposed** |
| | Repeated 401 or 403 errors, or a secret found in a log or output | System owner and security | The log entry | **Proposed** |
| | A cost or usage spike, or a metric below target after a change | System owner | The traces and `rag:eval` | **Proposed** |
| | Advice was followed and caused a data problem | Incident review | The trace of that run | Traces exist; process |
| **D. Stop** | Any doubt about safety | The operator | n/a | Set `ALLOW_FEED_CREATION=false`, `AUDIT_SOURCE=mock`, or remove the API key. Budgets and repeated invalid outputs also stop a run (**Proposed** for the search) |

## 5. Rationale and trade-offs

| Decision | Alternative | What it buys | What it costs |
|---|---|---|---|
| **Advisory and read-only by default** | Apply fixes automatically | No unreviewed production change. Connection settings affect data volume, the data feed documentation is labelled Limited Testing, and feed definitions cannot be read through the API, so a fix cannot be verified automatically | A person has to act, so it is slower |
| **One guarded write with three gates** (off by default, confirmation, audit log) | Remove the write, or allow it freely | Keeps a useful capability while making it deliberate and traceable | Friction for the person. The tool is not a one-click creator |
| **Deterministic checks first, model second** | Let a model judge the setup | Findings are exact, repeatable and testable. The model cannot invent a finding | Less flexible. Every new check is code |
| **Refuse when the notes do not cover the question** | Always answer | Fewer answers built on weak matches | Some correct questions are refused. Measured by `rag:eval` and tuned with the threshold |
| **Approve only writes, not reads** | Approve every action | Avoids approval fatigue. Reads are safe and cheap | A bad read is caught only by the checks and review tiers |
| **Login off and localhost-only by default** | Require single sign-on always | Easy to try, no setup | Weaker access control, which is why the server binds locally, refuses cross-origin requests and warns if writes are on. Shared use needs sign-on |
| **Logs for oversight** (writes and traces) | No logs | Accountability and measurement | Logs contain questions. They hold no credentials or answers, and need retention and access limits |
| **Show the exact prompt in no-key mode** | Hide it | The person can see precisely what leaves | Extra clicks |
| **Independent critic and search budgets** | One pass, no checks | A wrong diagnosis is expensive, so independent checking reduces self-confirmation | More calls and latency (see the Tree of Thoughts and multi-agent designs) |
| **Sample data by default, clearly labelled** | Require a live connection | Safe to demonstrate | A risk of confusion, handled by the banner |
| **Metrics gate changes** | Ship first, measure later | Regressions are caught | Slower changes |

**Autonomy ladder.** Today the tool is at the lowest rung: it recommends, and a person acts. A later rung would
let it propose a specific change with a preview and ask for approval. A rung that applies low-risk, reversible
changes on its own is not planned. Moving up needs sustained evidence: zero unapproved writes, unsupported-claim rate
under target across reviewed samples, and a reviewed incident history.

**Residual risks I accept:** a person can ignore a high finding or follow wrong advice despite the citations; the
audit cannot see existing data feeds; the hosted model sees whitelisted audit text; targets are unvalidated until
the first measurements are made. Each has a review tier or a planned measurement above.
