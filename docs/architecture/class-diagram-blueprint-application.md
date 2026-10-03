# Blueprint, application, validation, and provider classes

```mermaid
classDiagram-v2
  direction LR

  class Blueprint
  class ApplicationSchemaBoundary
  class ApplicationExecutionController
  class ApplicationTraceRecorder
  class BlueprintPreparationCache
  class BlueprintValidator
  class InputValidator
  class InputSchemaValidator
  class OutputValidator
  class JsonSchemaCompiler
  class SchemaGuard
  class Provider
  class HttpTransport
  class OpenAICompatibleProvider
  class AnthropicProvider
  class GeminiProvider

  ApplicationSchemaBoundary --> Blueprint : preloads
  ApplicationSchemaBoundary --> BlueprintValidator
  ApplicationSchemaBoundary --> InputValidator
  ApplicationSchemaBoundary --> InputSchemaValidator
  ApplicationSchemaBoundary --> OutputValidator
  ApplicationExecutionController ..> ApplicationSchemaBoundary : host preflight
  ApplicationTraceRecorder ..> ApplicationExecutionController : observes tasks

  BlueprintPreparationCache --> Blueprint
  BlueprintPreparationCache --> BlueprintValidator
  BlueprintValidator --> JsonSchemaCompiler
  InputSchemaValidator --> JsonSchemaCompiler
  OutputValidator --> JsonSchemaCompiler
  SchemaGuard --> OutputValidator

  OpenAICompatibleProvider ..|> Provider
  AnthropicProvider ..|> Provider
  GeminiProvider ..|> Provider
  OpenAICompatibleProvider *-- HttpTransport
  AnthropicProvider *-- HttpTransport
  GeminiProvider *-- HttpTransport
```

Application helpers validate graph edges, enforce admission policy, and record
value-free traces. They do not become a workflow engine. Host code still owns
sequencing, persistence, authorization, and side effects. Providers compose a
shared HTTP transport for error, timeout, and JSON handling while retaining
provider-specific request and response codecs.

Return to the [PixieCore class diagram index](class-diagrams.md).
