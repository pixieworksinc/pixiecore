# Evidence-first OCR document review demo

This is the canonical reusable asset set for the PixieCore OCR story. It uses
one scanned PDF, one small Extractor Blueprint, one versioned dataset case, and
one typed result in video, article, and conference formats.

Run the offline contract rehearsal after building PixieCore:

```bash
npm run build
node examples/demos/ocr-document-review/run.mjs --mode=mock
```

`mock` runs the real PixieCore validation and attachment pipeline with the
dataset's declared expected output. It proves the contract and presentation
flow without a credential. It does not measure OCR model accuracy.

Use `--mode=real` only with an explicitly configured provider/model that
supports the scanned PDF input. `--mode=both` prints fixture and real-provider
results side by side. Do not publish a quality claim from one run; use the
repeated benchmark and scorecard process in `docs/blueprints/evaluation.md`.

The selected case extracts `Riley Chen` and `Chicago, USA`, returns the absent
amount as `not_found`, and emits an `ocr_required` warning rather than inventing
a value. The application boundary may next map that typed result into a form,
human-review step, or workflow. This demo itself performs no persistence,
submission, approval, or notification.

See `demo.yaml` for the canonical assets, commands, story order, and evidence
labels. See `docs/blueprints/ocr-demo.md` for the video shot list, article outline, and
conference runbook.
