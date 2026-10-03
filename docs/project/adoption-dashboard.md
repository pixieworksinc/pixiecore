# PixieCore adoption dashboard

This dashboard reports only evidence-backed ecosystem metrics. A blank or
`not_collected` value is not zero. PixieCore does not add product telemetry to
estimate active projects, and this document must not turn unavailable data into
an adoption claim.

Latest period: **2026-08**

| Metric | Status | Value | Evidence | Note |
|---|---|---:|---|---|
| Installs | not_collected | N/A | N/A | The package has not been published to a registry with an authorized download report. |
| Active projects | not_collected | N/A | N/A | PixieCore does not add usage telemetry, and no opt-in project registry exists. |
| External contributors | not_collected | N/A | N/A | No reviewed public contributor roster or contribution report is available. |
| Published Blueprints | verified | 8 | [source](../../examples/blueprints/catalog.yaml) | Active first-party reference Blueprints in the packaged library catalog. |
| Case studies | not_collected | N/A | N/A | No reviewed public case-study evidence is available. |

## Monthly history

| Period | Installs | Active projects | External contributors | Published Blueprints | Case studies |
|---|---:|---:|---:|---:|---:|
| 2026-08 | N/A | N/A | N/A | 8 | N/A |

## Monthly update procedure

1. Copy the latest YAML snapshot to `adoption/snapshots/YYYY-MM.yaml`.
2. Replace a value only when its named evidence source exists and can be reviewed.
3. Keep unavailable metrics `not_collected`; never infer active use from package contents.
4. Run `npm run generate:adoption-dashboard` and the full project test suite.
5. Review the snapshot and generated diff in the same pull request.

The source schema is packaged as
`@pixieworks/pixiecore/adoption/snapshot-schema.json`. Snapshot history is packaged under
`adoption/snapshots`.
