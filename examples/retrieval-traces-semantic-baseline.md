# Retrieval traces: semantic-only baseline (before the keyword channel was added)

These two traces were produced by the author running `npm run rag:table` on their own machine with the real
embedding model (`Xenova/all-MiniLM-L6-v2`), a 53-chunk index and a similarity threshold of 0.3. They are the
"before" measurements that led to adding a BM25 keyword channel. Scores are cosine similarity.

## Q1: "Which columns cannot be included in a CJA data feed?"

The section that answers the question, **"Columns that are not available in a feed", is not among the 8 candidates.**

| Rank | Score | Section | Returned |
|---|---|---|---|
| 1 | 0.626 | Comparing CJA and Adobe Analytics data feeds > Where the feed columns come from | yes |
| 2 | 0.612 | Data feeds overview > What a CJA data feed is | yes |
| 3 | 0.582 | Creating a data feed > Columns that are always included in a feed | yes |
| 4 | 0.564 | Data feeds overview > Prerequisites for data feeds | yes |
| 5 | 0.564 | Creating a data feed > Details tab | no |
| 6 | 0.561 | Data feeds overview > Availability of data feeds | no |
| 7 | 0.544 | Comparing CJA and Adobe Analytics data feeds > Features that exist only in CJA feeds | no |
| 8 | 0.537 | Audit tool notes: planned feed checks > Audit tool note: feed.uniqueness-unchecked | no |

All eight candidates fall between 0.537 and 0.626: the embedding matched the general topic ("CJA data feed" appears
in every section) and not the specific wording of the question.

## Q2: "Can CJA data feeds be delivered over SFTP?"

The correct section ranked first, but only 0.008 ahead of second place.

| Rank | Score | Section | Returned |
|---|---|---|---|
| 1 | 0.551 | Comparing CJA and Adobe Analytics data feeds > Backfill window and destinations | yes |
| 2 | 0.543 | Data feeds overview > Prerequisites for data feeds | yes |
| 3 | 0.515 | Data feeds overview > What a CJA data feed is | yes |
| 4 | 0.501 | Creating a data feed > Compression, destination and manifest | yes |
| 5 | 0.462 | Data feeds overview > Availability of data feeds | no |
| 6 | 0.447 | Comparing CJA and Adobe Analytics data feeds > Delivery frequency, late hits and ordering | no |
| 7 | 0.415 | Comparing CJA and Adobe Analytics data feeds > When data is processed | no |
| 8 | 0.393 | Creating a data feed > Processing delay | no |

## What changed as a result

A BM25 keyword score is now added to the semantic score. Measured offline on the 18 in-scope questions in
`eval/questions.json` (independent of the embedding model), the keyword channel alone puts the correct section in the
top 4 for 18/18 questions and first for 13/18 (MRR 0.843). It ranks "Columns that are not available in a feed" third
for Q1. The combined result is measured with `npm run rag:eval`.
