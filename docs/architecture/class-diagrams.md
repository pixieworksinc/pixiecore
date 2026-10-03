# PixieCore class diagrams

These diagrams describe the current PixieCore 0.1.x implementation. They focus
on ownership, composition, and major runtime dependencies. Method signatures
are intentionally limited to operations that explain each boundary; TypeDoc is
the authoritative API reference for complete signatures.

## 1. Architecture overview

```mermaid
classDiagram-v2
  direction LR

  class HostApplication
  class PromptRuntime {
    <<facade>>
    +execute(path, inputs, options)
    +executeYaml(yaml, inputs, options)
    +registerTool(tool)
    +close()
  }
  class KernelPluginManager {
    <<kernel facade>>
  }
  class BootstrapPluginHost {
    <<bootstrap host>>
    +load()
    +close()
    +createProvider(name, options)
  }
  class KernelPromptProcessor {
    <<public facade>>
  }
  class RuntimePromptProcessor {
    <<interpreter>>
    +execute(blueprint, inputs, options)
  }
  class PluginEngine
  class OutputDecoratorPipeline
  class RuntimeToolExecutor
  class PluginCatalog {
    <<interface>>
  }
  class RuntimeProcessorServicesPort {
    <<interface>>
  }
  class Provider {
    <<interface>>
    +generate(request)
  }
  class McpManager
  class BlueprintPreparationCache
  class PixieCoreLogger

  HostApplication --> PromptRuntime : executes Blueprints
  PromptRuntime *-- KernelPluginManager : owns
  PromptRuntime *-- KernelPromptProcessor : owns
  PromptRuntime *-- McpManager : owns
  PromptRuntime *-- BlueprintPreparationCache : owns
  PromptRuntime *-- PixieCoreLogger : owns or adapts
  KernelPluginManager *-- BootstrapPluginHost
  KernelPromptProcessor *-- RuntimePromptProcessor
  BootstrapPluginHost *-- PluginEngine
  PluginEngine --> PluginCatalog : activates
  RuntimePromptProcessor --> RuntimeProcessorServicesPort : uses
  RuntimePromptProcessor --> Provider : calls
  RuntimePromptProcessor *-- OutputDecoratorPipeline
  RuntimePromptProcessor *-- RuntimeToolExecutor
```

`KernelPluginManager` is the public class exported as `PluginManager` from
`src/core/kernel/plugin/manager.ts`. `BootstrapPluginHost` is the private host
implemented in `src/core/bootstrap/plugin-manager/manager.ts`. The public
facade delegates to that host and never exposes its mutable registries.

## 2. Runtime and processor

```mermaid
classDiagram-v2
  direction LR

  class PromptRuntime {
    -lifecycleState
    -activeExecutions
    +provider Provider
    +execute(path, inputs, options)
    +executeYaml(yaml, inputs, options)
    +registerTool(tool)
    +close()
  }
  class KernelPromptProcessor {
    +execute(blueprint, inputs, options)
    +registerTool(tool)
    +registerAgentRole(role)
    +registerDecorator(decorator, priority)
  }
  class RuntimePromptProcessor {
    -maxRetry
    -maxToolRounds
    -prepareExecution()
    -runAttempt()
  }
  class OutputDecoratorPipeline {
    +register(decorator, priority)
    +apply(stage, context)
  }
  class RuntimeToolExecutor {
    +register(tool)
    +execute(name, arguments)
    +executeCalls(calls)
  }
  class BlueprintPreparationCache {
    +loadFile(path, validator)
    +loadYaml(yaml, validator)
    +snapshot()
  }
  class BlueprintValidator {
    +validateFile(path)
    +validateYaml(yaml)
  }
  class RuntimeServicePort {
    <<interface>>
    +processorServices RuntimeProcessorServicesPort
    +mcp McpServicePort
  }
  class RuntimeProcessorServicesPort {
    <<interface>>
    +logging LoggingServicePort
    +validation ValidationServicePort
    +multimodal MultimodalServicePort
    +tools ToolServicePort
    +jit JitExecutionPort
  }
  class Provider {
    <<interface>>
    +name string
    +model string
    +generate(request)
  }
  class AgentRolePlugin {
    <<interface>>
    +supportedRoles
    +apply(context)
  }
  class OutputDecorator {
    <<interface>>
    +validate(output, context)
  }
  class RegisteredTool {
    <<interface>>
    +name string
    +execute(arguments)
  }
  class McpManager {
    +load(configPath)
    +callTool(server, tool, arguments)
    +close()
  }
  class PixieCoreLogger

  KernelPromptProcessor *-- RuntimePromptProcessor
  PromptRuntime *-- KernelPromptProcessor
  PromptRuntime *-- BlueprintPreparationCache
  PromptRuntime *-- McpManager
  PromptRuntime *-- PixieCoreLogger
  PromptRuntime --> RuntimeServicePort : resolves from plugins
  BlueprintPreparationCache --> BlueprintValidator : validates with
  RuntimePromptProcessor --> RuntimeProcessorServicesPort
  RuntimePromptProcessor --> Provider
  RuntimePromptProcessor *-- OutputDecoratorPipeline
  RuntimePromptProcessor *-- RuntimeToolExecutor
  RuntimePromptProcessor o-- AgentRolePlugin
  OutputDecoratorPipeline o-- OutputDecorator
  RuntimeToolExecutor o-- RegisteredTool
  McpManager --> RegisteredTool : exposes MCP tools as
```

The runtime owns lifecycle and resource closure. The processor owns one
Blueprint execution, including bounded provider correction retries and bounded
tool rounds. `RuntimeProcessorServicesPort` keeps validation, logging,
multimodal conversion, tool naming, and optional JIT execution scope-local.

## 3. PluginManager, catalogs, and Recipe

```mermaid
classDiagram-v2
  direction TB

  class KernelPluginManager {
    <<public facade>>
  }
  class BootstrapPluginHost {
    <<bootstrap host>>
    +load()
    +close()
    +registerAgentRole(role)
    +registerDecorator(decorator, priority)
    +registerTool(tool)
    +registerProvider(provider)
  }
  class PluginEngine {
    +activateSynchronousRoots(ids)
    +load()
    +close()
    +trackResource(value)
  }
  class PluginLifecycle
  class ContributionRegistries
  class ScopedServiceRegistry
  class PluginStatusTracker
  class PluginCatalog {
    <<interface>>
    +synchronousDefinitions()
    +definitions()
  }
  class StaticCorePluginCatalog
  class CompositePluginCatalog
  class ManagedPluginCatalog
  class LegacyPluginCatalog
  class PluginDefinition {
    <<interface>>
    +descriptor
    +loadActivator()
  }
  class PluginActivator {
    <<interface>>
    +activate(context)
  }
  class PluginActivationContext {
    <<interface>>
    +services
    +own(value)
    +registerAgentRole(role)
    +registerDecorator(decorator, priority)
    +registerTool(tool)
    +registerProvider(provider)
  }
  class RecipeServicePort {
    <<interface>>
    +standardRecipe()
  }
  class PluginRecipeDefinition {
    <<data contract>>
  }
  class PluginRecipeActivationPlan {
    <<data contract>>
  }

  KernelPluginManager *-- BootstrapPluginHost
  KernelPluginManager --> StaticCorePluginCatalog : creates
  KernelPluginManager --> RecipeServicePort : resolves
  RecipeServicePort --> PluginRecipeDefinition : returns
  PluginRecipeDefinition --> PluginRecipeActivationPlan : planPluginRecipe
  PluginRecipeActivationPlan --> KernelPluginManager : applyPluginRecipe

  BootstrapPluginHost *-- PluginEngine
  BootstrapPluginHost *-- ContributionRegistries
  BootstrapPluginHost *-- ScopedServiceRegistry
  BootstrapPluginHost *-- PluginStatusTracker
  PluginEngine *-- PluginLifecycle
  PluginEngine --> PluginCatalog
  PluginEngine --> PluginDefinition
  PluginDefinition --> PluginActivator : loads
  PluginEngine --> PluginActivationContext : supplies
  PluginActivationContext --> ContributionRegistries : registers into
  PluginActivationContext --> ScopedServiceRegistry : resolves from

  StaticCorePluginCatalog ..|> PluginCatalog
  CompositePluginCatalog ..|> PluginCatalog
  ManagedPluginCatalog ..|> PluginCatalog
  LegacyPluginCatalog ..|> PluginCatalog
  CompositePluginCatalog o-- PluginCatalog : combines
```

Only `pixiecore.recipe` is activated directly by the public facade. Its locked
Recipe selects the required core roots. `PluginEngine` resolves dependency
order, activates definitions, records status, and transfers cleanup ownership
to `PluginLifecycle`. Managed and legacy catalogs remain behind the same
`PluginCatalog` interface.

## 4. Blueprint, application, validation, and providers

The fourth diagram is maintained as a separate project document so each
TypeDoc page has an isolated Mermaid rendering scope:

- [Blueprint, application, validation, and provider classes](class-diagram-blueprint-application.md)

## Source map

| Diagram name | Implementation |
|---|---|
| `PromptRuntime` | [`src/core/kernel/runtime/index.ts`](../../src/core/kernel/runtime/index.ts) |
| `KernelPluginManager` | [`src/core/kernel/plugin/manager.ts`](../../src/core/kernel/plugin/manager.ts) |
| `BootstrapPluginHost` | [`src/core/bootstrap/plugin-manager/manager.ts`](../../src/core/bootstrap/plugin-manager/manager.ts) |
| `PluginEngine` | [`src/core/bootstrap/plugin-manager/activation/engine.ts`](../../src/core/bootstrap/plugin-manager/activation/engine.ts) |
| Catalog implementations | [`src/core/bootstrap/plugin-manager/catalog/index.ts`](../../src/core/bootstrap/plugin-manager/catalog/index.ts), [`src/core/kernel/plugin/catalog.ts`](../../src/core/kernel/plugin/catalog.ts), and [`src/core/bootstrap/plugin-manager/managed/catalog.ts`](../../src/core/bootstrap/plugin-manager/managed/catalog.ts) |
| `KernelPromptProcessor` | [`src/core/kernel/processor/index.ts`](../../src/core/kernel/processor/index.ts) |
| `RuntimePromptProcessor` | [`src/plugins/runtime/src/processor.ts`](../../src/plugins/runtime/src/processor.ts) |
| `OutputDecoratorPipeline` | [`runtime/decorator-pipeline.ts`](../../src/plugins/runtime/src/decorator-pipeline.ts) |
| `RuntimeToolExecutor` | [`runtime/tool-executor.ts`](../../src/plugins/runtime/src/tool-executor.ts) |
| Application classes | [`application/mapping.ts`](../../src/core/kernel/application/mapping.ts), [`application/graph.ts`](../../src/core/kernel/application/graph.ts), [`application/execution.ts`](../../src/core/kernel/application/execution.ts), [`application/control.ts`](../../src/core/kernel/application/control.ts), and [`application/trace.ts`](../../src/core/kernel/application/trace.ts) |
| Validation classes | [`validation/blueprint.ts`](../../src/plugins/validation/src/schema/blueprint.ts), [`validation/input/index.ts`](../../src/plugins/validation/src/input/index.ts), [`validation/output.ts`](../../src/plugins/validation/src/schema/output.ts), and [`validation/json-schema.ts`](../../src/plugins/validation/src/schema/json-schema.ts) |
| Provider classes | [`providers/shared.ts`](../../src/plugins/providers/src/shared.ts), [`providers/openai-compatible.ts`](../../src/plugins/providers/src/openai-compatible.ts), [`providers/anthropic.ts`](../../src/plugins/providers/plugins/anthropic/src/anthropic/index.ts), and [`providers/gemini.ts`](../../src/plugins/providers/plugins/gemini/src/gemini/index.ts) |
