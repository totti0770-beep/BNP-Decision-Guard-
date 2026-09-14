# The field evaluation set

This directory holds the questions the assistant is evaluated on, as data. You
do not need to read or write TypeScript to change them.

## Rule one

**Never write a question by reading a policy.**

A question written from a document tests nothing — it guarantees the wording
matches, so of course retrieval finds it. That is why the older gold set
(`apps/api/test/support/gold-set.ts`) is a regression detector and not a
measurement: it was written from the four demo documents it searches.

Questions here come from practice: what staff actually looked up, asked at
handover, or got wrong. `docs/clinical-validation.md` §5.1 is the protocol.

## What ships today

`field-set.starter.jsonl` is a **starter**, every case marked
`"provenance": "engineering-authored"` — written by whoever built the platform,
not by ward staff. It exists so the runner has something to run and so the
governed behaviours are exercised from day one. It is **not** evidence about
what nurses ask, and no figure taken from it belongs in a report to anyone.

Replace it. Keep the filename or pass `--cases` at yours.

## The format

One JSON object per line. Blank lines and `#` comments are ignored, so the file
can carry its own collection notes.

```json
{"id":"icu-0007","question":"…","language":"ar","provenance":"ward-submitted","intent":"unknown","topic":"weight-banded dosing","paraphraseOf":"icu-0006","note":""}
```

| field | required | meaning |
| --- | --- | --- |
| `id` | yes | stable, never reused. A renumbered id breaks every past report. |
| `question` | yes | **verbatim, in the language it was asked.** Do not tidy it up — an ambiguous question is data, not a defect. |
| `language` | yes | `ar` or `en` |
| `provenance` | yes | `ward-submitted` · `educator-authored` · `engineering-authored` |
| `intent` | yes | `unknown` · `expect-answer` · `expect-refusal` — what the *author* expects. Reported, never asserted. |
| `topic` | yes | free text, used to group the report |
| `paraphraseOf` | no | id of the case this rewords. See below — this is the highest-value optional field. |
| `corpus` | no | the corpus the `intent` was established against, e.g. `seeded-demo`. Only then is the expectation checked. |
| `note` | no | anything a reviewer should know |

Four fields are **rejected** by the loader: `expectSource`,
`expectAnswerContains`, `expectedAnswer`, `expectRefusal`. A field set records
no expected document and no expected answer. Whoever asks what staff look up
does not know which page of the library holds the answer — and if they do know,
they wrote the question from the page, which is rule one again.

### Paraphrases are the cheapest thing you can add

Ask the same question twice — reworded, or in the other language — and link the
second to the first with `paraphraseOf`. If the two reach different documents,
or one answers and the other refuses, retrieval matched vocabulary rather than
meaning. **Nobody has to know the right answer to see that.**

### Identifiers

The loader runs every question through the same PHI screen the API uses and
refuses to load a file containing one. A question collected on the ward with a
real medical-record number in it is stopped before it leaves the machine.
Rewrite the question without the identifier; the identifier was never the
question.

## Running it

Against a live deployment, as a nurse:

```bash
EVAL_PASSWORD='…' npm run eval:field -w @bnp/api -- \
  --base-url https://api.example.health \
  --email nurse.eval@example.health \
  --cases eval/field-set.starter.jsonl \
  --out sheet.md
```

`--json` prints a machine record instead, with no timestamp inside the data so
runs diff cleanly. `EVAL_MFA_CODE` covers an account with MFA enrolled.

In CI, against the demo corpus, the same cases run through
`apps/api/test/field-set.e2e-spec.ts` on every push. `npm run test:eval:field`
writes the sheet locally.

## What comes out, and what it is worth

A half-filled version of the `docs/clinical-validation.md` §5.2 scoring sheet:
every column a machine can determine is filled in, and the four clinical
judgement columns — supported, citation correct, refusal appropriate, could
mislead — are left blank for a reviewer.

That division is the whole design. **The runner produces the paperwork, not the
verdict.** Sign-off under §6 turns on those four columns and on nothing this
tool prints.
