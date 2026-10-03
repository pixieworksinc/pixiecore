# Travel document field Extractor

This reference Blueprint extracts a requested subset of travel-form fields from
exactly one PDF or screenshot. It is one cognitive function: it reads fields and
returns source evidence. Date conversion, city classification, validation,
verification, summarization, approval routing, persistence, and notification
belong to separate Blueprint or application boundaries.

## Contract

Supply exactly one of `file_path` or `image_path`, plus a non-empty unique
`requested_fields` array. Each requested field appears once in the output and
has one of three states:

Supported fields are traveler name, document number, trip dates, destination,
business purpose, estimated amount, and currency.

- `extracted`: a copied value with a one-based page and verbatim evidence text.
- `not_found`: the attachment is readable, but the requested field is absent.
- `unreadable`: relevant content cannot be read with sufficient confidence.

The Blueprint never derives missing values from a filename, outside knowledge,
nearby fields, or a likely OCR correction. Screenshots count as page 1. Output
dates and amounts remain document text; later Converter and Validator
Blueprints own normalization and validation.

PixieCore routes PDFs and images through its existing multimodal provider
contract. It does not claim to bundle an OCR engine. A selected provider must
support file input for PDFs and vision for screenshots; live accuracy therefore
depends on the selected provider and model.

## Canonical fixtures

| Fixture | Boundary |
|---|---|
| `fixtures/native-text.pdf` | one-page PDF with a searchable text layer |
| `fixtures/scanned.pdf` | image-only PDF requiring OCR |
| `fixtures/multi-page.pdf` | evidence located on page 2 |
| `fixtures/rotated.pdf` | page rotated 90 degrees |
| `fixtures/blank-page.pdf` | no readable content and no inferred values |
| `fixtures/table.pdf` | requested values in a two-column table |
| `fixtures/travel-request-screenshot.png` | web-form screenshot treated as page 1 |

These are fixed semantic fixtures rather than arbitrary test data: their exact
visible text, page, orientation, and text-layer properties define the expected
contract. Runtime-generated test-only identifiers still use the suite-wide
`TEST_SEED` policy.

All fixture documents are synthetic project assets generated exclusively from
the literal sample data in the checked-in script. They do not reproduce an
external form, document, screenshot, or personal record.

Regenerate the fixtures from the checked-in source script:

```bash
python3 -m pip install reportlab pillow pypdf
python3 examples/blueprints/extractor/travel-document-fields/scripts/generate-fixtures.py
```

Optional visual QA renders every PDF page and the screenshot into a contact
sheet below `tmp/pdfs/`:

```bash
python3 -m pip install pymupdf pillow
python3 examples/blueprints/extractor/travel-document-fields/scripts/render-fixtures.py
```

## Evaluation

The versioned dataset covers all seven fixture boundaries, exact field order,
source pages, verbatim evidence, missing values, and unreadable documents. Its
canonical target is 7/7 exact semantic passes and 7/7 schema passes:

```bash
pixiecore blueprint eval \
  examples/blueprints/extractor/travel-document-fields/evaluations/travel-document-fields.yaml \
  --seed=extractor-reference-1
```

The contract test is offline: a fixture provider returns the checked-in
expected outputs while assertions verify that PixieCore supplies the correct
real attachment and prompt for every case. A live provider evaluation is an
explicit, credentialed follow-up and must record provider, model, version,
temperature, execution time, and the result artifact before making an accuracy
claim.

## Known non-supported inputs

- More than one attachment in a single execution.
- Handwriting or content whose OCR is uncertain.
- Password-protected, corrupt, or unsupported document formats.
- Values that require arithmetic, currency conversion, date normalization, or
  external lookup.
- Evidence coordinates or bounding boxes; v1 records page plus visible text.
- Treating an absent field as an empty string or guessed value.

Do not persist sensitive source documents or evaluation artifacts implicitly.
The application host owns upload controls, retention, redaction, and access
policy.
