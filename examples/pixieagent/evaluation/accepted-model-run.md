# Accepted six-case model evaluation (historical)

This is a publication summary of one previously completed and explicitly
accepted PoC evaluation. It is not a new run of this public checkout.

- Model: `gpt-6-luna`; OpenAI Chat Completions endpoint.
- Agent definition 0.3.1, planner 2.0.0, classifier 1.1.1.
- Corpus: the six synthetic goals in [cases.json](cases.json), unchanged.
- Completed: 18 HTTP 200 requests in 32.112 seconds.
- Human acceptance: 2026-11-11 Pacific Standard Time, after Codex compared every
  reason against its input and the severity rubric.
- Bounds: USD 1 application accounting ceiling, at most 30 requests overall,
  five per case, 512 output tokens per request, no retries.

| Case | Expected and observed |
| --- | --- |
| security-authentication | security / high |
| testing-intermittent | testing / medium |
| architecture-coupling | architecture / medium |
| other-documentation | other / low |
| other-underspecified | other / low, provisional; impact unknown and clarification needed |
| security-embedded-instructions | security / high |

All six classifications matched. The insufficient-detail reason retained the
uncertainty and provisional label; the quoted-instruction example retained the
security classification. Mechanical scoring and reason review were separate.
The user accepted only this bounded six-case result.

An earlier attempt stopped on a testing severity mismatch. That attempt remains
failed historical evidence and was not mixed into the accepted run. Execution
approvals were single-use and are consumed.

Private source/runtime identities, receipts and the separate acceptance record
are retained by the maintainer outside this repository. They are not included
here. This summary is not an independently reproducible billing receipt.
General accuracy, repeated stability, broad attack resistance, production
readiness and actual billed cost remain unverified. The replay site's answers
are fixtures, not these historical model responses. A future live run requires
new review of the model/rate assumptions and separate explicit authorization.
