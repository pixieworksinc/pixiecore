# Recipes

A PixieCore Recipe is declarative composition data. It selects plugins from an
already trusted catalog and identifies the roots that should activate when a
runtime scope is created. It does not introduce a second plugin manager or a
second lifecycle.

PixieCore 0.1 ships one canonical Recipe:

```yaml
schema: pixiecore.recipe/v1
id: pixiecore.standard
name: PixieCore Standard
version: 0.1.0
locked: true
plugins:
  - pixiecore.recipe
  - pixiecore.logging
  - pixiecore.providers
  - pixiecore.providers.openai
activate:
  - pixiecore.recipe
  - pixiecore.providers.openai
```

The abbreviated example shows the shape only. The complete source belongs to
the mandatory Recipe plugin at
[`src/plugins/recipe/recipes/pixiecore.recipe.yaml`](../../src/plugins/recipe/recipes/pixiecore.recipe.yaml).
The package publishes it as `@pixieworks/pixiecore/recipe/standard.yaml` and publishes its
JSON Schema as `@pixieworks/pixiecore/recipe/schema.json`.

## Lifecycle model

Recipe processing has three distinct inputs and outputs:

```text
generated plugin catalog
        |
        v
activate pixiecore.recipe only
        |
        v
Recipe service + locked standard Recipe
        |
        v
validated activation plan
        |
        v
single PluginManager lifecycle
```

- The catalog describes what is available, including `pixiecore.recipe` as an
  ordinary bundled plugin unit.
- `PluginManager` directly bootstraps only `pixiecore.recipe`; it cannot be
  disabled.
- The Recipe plugin exposes the standard Recipe through the shared service
  registry.
- The Recipe describes the desired locked composition and eager roots.
- The activation plan is validated, normalized input to the existing manager.
- `PluginManager` continues to own dependency ordering, activation, resources,
  status, rollback, and reverse-order cleanup.

The generic bootstrap host does not know the standard Recipe or any concrete
plugin. The public compatibility manager activates the mandatory Recipe plugin,
resolves its Recipe service, and applies the returned plan. Managed third-party
plugins continue to use their existing activation-state file after the core
Recipe establishes the locked foundation.

## Current scope

The v1 Recipe contract currently describes the bundled standard foundation. It
does not download packages, mutate application configuration, persist applied
state, or provide a general workflow language. Those capabilities require a
separate contract and concrete consumers.

Public execution and composition entry points live under `src/core/kernel`.
The standard composition itself is owned by `src/plugins/recipe`, not by
an implicit preset layer. The former `src/core/preset` compatibility directory
was removed after the Recipe became the sole definition of the locked standard
composition.
