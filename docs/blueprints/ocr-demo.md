# Canonical OCR document-review demo

This kit presents one PixieCore idea consistently across a short video, article,
conference talk, or live technical review:

> A scanned document can be handled by one small typed Extractor Blueprint,
> returning requested fields with page evidence and explicit unknowns. A host
> application composes that result with forms, review, and workflows.

The canonical manifest is
[`examples/demos/ocr-document-review/demo.yaml`](../../examples/demos/ocr-document-review/demo.yaml).
Do not replace its fixture, dataset case, or claim labels in one format without
updating the others.

## Five-minute live sequence

| Time | Show | Say | Evidence |
|---:|---|---|---|
| 0:00 | The scanned PDF | The input has no trusted text layer. | Packaged fixture |
| 0:30 | Extractor YAML | This Blueprint asks for fields and typed evidence, not an entire workflow. | Blueprint v1.1.0 |
| 1:30 | Input/output schemas | Missing and unreadable values have explicit states. | Public schema contract |
| 2:15 | Offline command | The no-credential run rehearses the exact contract and visual flow. | Versioned dataset fixture |
| 3:00 | JSON fields | Traveler and city have page evidence; absent amount is `not_found`. | `scanned-pdf-partial` case |
| 4:00 | Application boundary | Form fill, approval, persistence, and notification remain host-owned. | Architecture contract |
| 4:40 | Real/benchmark modes | One real run is a demo; repeated authorized runs can support a later quality claim. | Release-specific scorecard required |

## Commands

```bash
npm ci
npm run build
node examples/demos/ocr-document-review/run.mjs --mode=mock
```

Optional real-provider modes:

```bash
node examples/demos/ocr-document-review/run.mjs --mode=real
node examples/demos/ocr-document-review/run.mjs --mode=both
```

Set provider credentials through the documented PixieCore environment only.
Never paste a credential into a slide, terminal command, recording, fixture,
or repository. Before recording, use a clean terminal and confirm that command
history, prompts, logs, and environment output reveal no secret.

## Video shot list

1. Open on the scanned page at readable zoom.
2. Show only the Extractor's name, version, requested fields, and output schema.
3. Run the offline command without editing the result.
4. Highlight `source.page`, `evidence_text`, `not_found`, and `ocr_required`.
5. Show the one-Blueprint and application boundary diagram from the architecture
   guide.
6. End on the exact real-provider and benchmark qualification, not a generic
   accuracy claim.

Use captions and read important JSON states aloud. Do not rely on color alone
to distinguish extracted, missing, and unreadable results.

## Article outline

1. The problem: OCR output becomes unsafe when absent data is silently guessed.
2. The unit: one Extractor Blueprint with requested fields and typed evidence.
3. The contract: input, output, version, dataset, and failure states.
4. The walkthrough: scanned fixture, command, and annotated JSON result.
5. The composition: mapping into a web form and human review without hiding
   side effects in the prompt.
6. The evidence boundary: offline fixture regression versus repeated real-model
   evaluation.
7. The next step: replace only the host integration or configured provider,
   while keeping the Blueprint contract independently testable.

## Conference runbook

- Prebuild the repository and run `--mode=mock` once before the session.
- Keep the offline command as the guaranteed path. Network and provider access
  are optional demonstrations, never prerequisites for the explanation.
- If a real call fails, show the typed failure or switch to the offline result;
  do not retry indefinitely or substitute an unrecorded result.
- Use the same PDF, case ID, Blueprint version, and output fields in slides and
  terminal output.
- Reserve questions about queues, approval, persistence, and UI for the host
  application boundary.

## Claim boundary

The offline path proves that PixieCore loads the real PDF attachment, validates
the Blueprint input/output contract, and reproduces the versioned expected
case through a fixture Provider. It does not prove a remote model's OCR quality.

A live `--mode=real` result proves only that one configured provider/model
completed one case at that time. Publish accuracy, variance, latency, token,
or cost claims only from an authorized repeated benchmark artifact and
scorecard created for that release. The initial public snapshot contains no
real-provider OCR measurement.
