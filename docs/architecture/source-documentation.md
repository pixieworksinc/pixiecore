# Source documentation and TypeDoc

PixieCore treats source documentation as part of its public and internal
contracts. Documentation comments use TSDoc-compatible `/** ... */` blocks so
that editors, ESLint, TypeScript declarations, and TypeDoc consume one source.

## Required coverage

Production TypeScript under `src/core` and `src/plugins` requires:

- a non-empty file header describing the file's responsibility;
- a TSDoc comment on every class and constructor;
- a TSDoc comment on every public, protected, and private class method;
- a TSDoc comment on exported interfaces, type aliases, enums, and functions;
- a TSDoc comment on every interface method and call signature.

Generated sources and plugin-owned tests are excluded. Their generators or test
names are the authoritative documentation for those files.

Comments explain responsibility, policy, side effects, ownership, lifecycle,
failure behavior, or concurrency boundaries. They do not repeat TypeScript type
annotations. Public operations use `@param`, `@returns`, `@throws`, and
`@remarks` when those tags clarify behavior that the signature cannot express.

## Generate the API reference

```bash
npm run docs:api
```

The generated HTML is written to `build/api-docs/index.html`. `build/` is a
local artifact and is not included in the npm package.

The generated navigation includes the maintained
[PixieCore class diagrams](class-diagrams.md) as a project document. Mermaid is
copied into the generated site so diagrams render offline without a CDN.

The package build compiles runtime JavaScript and public declarations in two
passes. Runtime JavaScript omits comments to keep the installed package small,
while declaration files retain the public API documentation used by editors.
File-level comments remain in the TypeDoc source but are removed from generated
declarations because they duplicate the HTML module documentation.

## Validate documentation

```bash
npm run check:source-docs
npm run check:api-docs
```

`check:source-docs` verifies file headers, rejects known placeholder prose, and
runs the TSDoc-oriented ESLint rules. `check:api-docs` converts the complete
public package surface without emitting HTML and treats missing required API
documentation as an error.

Both checks run in CI and `prepack`. A new method or public declaration cannot
silently enter the package without documentation.
