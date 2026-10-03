# Searchable Blueprint catalog

This dependency-free static site searches the packaged PixieCore reference
Blueprint catalog by use case, schema term, quality-evidence kind, provider,
license, and minimum score.

From the PixieCore repository or installed package root, run:

```bash
python3 -m http.server 8000 --directory examples/blueprints/catalog-site
```

Then open `http://127.0.0.1:8000`. The site performs no network requests beyond
loading its local files. `catalog.json` is generated deterministically from the
library catalog, quality catalog, and Blueprint schemas. Regenerate it with
`npm run generate:blueprint-catalog-site` and verify drift with
`npm run check:blueprint-catalog-site`.

An `offline_contract` score proves deterministic fixture behavior. It is not a
remote-model accuracy claim. Remote provider measurements appear only after a
benchmark artifact is published under the quality-catalog contract.
Measurements marked `historical` remain visible for audit but are excluded from
the site's default provider and score filters until a current benchmark replaces
them.
