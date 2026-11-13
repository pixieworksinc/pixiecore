/**
 * Experimental PixieAgent orchestration, outside PixieCore's single-Blueprint runtime.
 * This runner selects only explicitly declared Blueprints, bounds decisions,
 * and requires host approval before invoking any write-capable action.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface BlueprintRef {
  readonly path: string;
  readonly version: string;
}

export interface AgentAction {
  readonly id: string;
  readonly description: string;
  readonly blueprint: BlueprintRef;
  readonly permission: 'read' | 'write';
}

export interface AgentDefinition {
  readonly schema: 'pixieagent.definition/v0';
  readonly id: string;
  readonly version: string;
  readonly planner: BlueprintRef;
  readonly max_actions: number;
  readonly actions: readonly AgentAction[];
}

/** Adapt PromptRuntime.execute() or a test double to this narrow interface. */
export interface BlueprintExecutor {
  execute(
    blueprintPath: string,
    inputs: JsonObject,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

export interface AgentObservation {
  readonly action_id: string;
  readonly input: JsonObject;
  readonly output: JsonValue;
}

export interface AgentRunResult {
  readonly result: JsonValue;
  readonly observations: readonly AgentObservation[];
  readonly decisions: number;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** The host, not the LLM, authorizes every write-capable action. */
  readonly authorizeWrite?: (
    action: AgentAction,
    inputs: JsonObject,
  ) => boolean | Promise<boolean>;
}

const MAX_ACTIONS = 32;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 64;

export class PixieAgentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PixieAgentError';
  }
}

export class PixieAgent {
  private readonly pinnedDefinition: AgentDefinition;
  private readonly executor: BlueprintExecutor;
  private readonly actions: ReadonlyMap<string, AgentAction>;

  constructor(definition: AgentDefinition, executor: BlueprintExecutor) {
    let definitionSnapshot: JsonValue;
    try {
      definitionSnapshot = cloneJson(definition, 'agent definition');
    } catch (error) {
      if (!(error instanceof PixieAgentError)) throw error;
      throw new PixieAgentError('invalid_definition', 'Agent definition must be bounded, plain JSON');
    }
    validateDefinition(definitionSnapshot);
    this.pinnedDefinition = snapshotDefinition(definitionSnapshot);
    this.executor = executor;
    this.actions = new Map(this.pinnedDefinition.actions.map(action => [action.id, action]));
  }

  get definition(): AgentDefinition { return this.pinnedDefinition; }

  async run(goal: string, options: RunOptions = {}): Promise<AgentRunResult> {
    if (typeof goal !== 'string' || !goal.trim()) {
      throw new PixieAgentError('invalid_goal', 'Agent goal must not be blank');
    }
    const observations: AgentObservation[] = [];
    for (let decisionIndex = 0; decisionIndex <= this.definition.max_actions; decisionIndex++) {
      options.signal?.throwIfAborted();
      const plannerInput = cloneJson({
        goal,
        decision_index: decisionIndex,
        allowed_actions: this.definition.actions.map(a => ({
          id: a.id,
          description: a.description,
          permission: a.permission,
        })),
        observations,
      }, 'planner input') as JsonObject;
      const raw = await this.executor.execute(this.definition.planner.path, plannerInput, signalOption(options.signal));
      options.signal?.throwIfAborted();
      const decision = parseDecision(raw);
      if (decision.kind === 'finish') {
        return {
          result: decision.result,
          observations: [...observations],
          decisions: decisionIndex + 1,
        };
      }
      if (decisionIndex === this.definition.max_actions) {
        throw new PixieAgentError('action_budget_exhausted', 'Agent exceeded max_actions before finishing');
      }
      const action = this.actions.get(decision.action_id);
      if (!action) {
        throw new PixieAgentError('unknown_action', `Planner selected undeclared action: ${decision.action_id}`);
      }
      if (action.permission === 'write') {
        // Fail closed. A Blueprint cannot grant itself host write authority.
        freezeJson(decision.input);
        const authorize = options.authorizeWrite;
        if (!authorize || await waitForAuthorization(() => authorize(action, decision.input), options.signal) !== true) {
          throw new PixieAgentError('write_not_authorized', `Write action not authorized: ${action.id}`);
        }
      }
      options.signal?.throwIfAborted();
      const rawOutput = await this.executor.execute(
        action.blueprint.path, cloneJson(decision.input, 'action input') as JsonObject, signalOption(options.signal),
      );
      options.signal?.throwIfAborted();
      const output = cloneJson(rawOutput, `output from ${action.id}`);
      observations.push({ action_id: action.id, input: decision.input, output });
    }
    throw new PixieAgentError('invalid_state', 'Unreachable planner state');
  }
}

/** Cancel an unfinished host approval without starting its write action. */
async function waitForAuthorization(
  authorize: () => boolean | Promise<boolean>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  signal?.throwIfAborted();
  if (!signal) return authorize();
  let onAbort = (): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // The race observes late rejections too, after cancellation already won.
    return await Promise.race([
      Promise.resolve().then(() => { signal.throwIfAborted(); return authorize(); }),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function signalOption(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function parseDecision(value: unknown):
  | { kind: 'act'; action_id: string; input: JsonObject }
  | { kind: 'finish'; result: JsonValue } {
  if (!isPlainRecord(value)) throw new PixieAgentError('invalid_decision', 'Planner must return a JSON object');
  const snapshot = cloneJson(value, 'planner decision') as JsonObject;
  if (snapshot.kind === 'finish' && 'result' in snapshot) {
    return { kind: 'finish', result: cloneJson(snapshot.result, 'planner final result') };
  }
  if (snapshot.kind === 'act' && nonBlank(snapshot.action_id) && isPlainRecord(snapshot.input)) {
    return {
      kind: 'act', action_id: snapshot.action_id,
      input: cloneJson(snapshot.input, 'action input') as JsonObject,
    };
  }
  throw new PixieAgentError('invalid_decision', 'Expected finish(result) or act(action_id,input)');
}

function validateDefinition(definition: unknown): asserts definition is AgentDefinition {
  if (!isPlainRecord(definition) || definition.schema !== 'pixieagent.definition/v0' || !nonBlank(definition.id)
    || !nonBlank(definition.version) || !validRef(definition.planner)
    || typeof definition.max_actions !== 'number' || !Number.isSafeInteger(definition.max_actions) || definition.max_actions < 1
    || definition.max_actions > MAX_ACTIONS || !Array.isArray(definition.actions)
    || definition.actions.length === 0 || definition.actions.length > MAX_ACTIONS) {
    throw new PixieAgentError('invalid_definition', 'Invalid PixieAgent definition');
  }
  const ids = new Set<string>();
  for (const action of definition.actions) {
    if (!isPlainRecord(action) || !nonBlank(action.id) || ids.has(action.id)
      || !nonBlank(action.description) || !validRef(action.blueprint)
      || (action.permission !== 'read' && action.permission !== 'write')) {
      throw new PixieAgentError('invalid_definition', 'Invalid or duplicate action');
    }
    ids.add(action.id);
  }
}

/** Never retain caller-owned action, permission, path, or budget references. */
function snapshotDefinition(definition: AgentDefinition): AgentDefinition {
  return Object.freeze({
    schema: definition.schema, id: definition.id, version: definition.version,
    planner: Object.freeze({ path: definition.planner.path, version: definition.planner.version }),
    max_actions: definition.max_actions,
    actions: Object.freeze(definition.actions.map(action => Object.freeze({
      id: action.id, description: action.description, permission: action.permission,
      blueprint: Object.freeze({ path: action.blueprint.path, version: action.blueprint.version }),
    }))),
  });
}

/** Freeze an already validated JSON snapshot before a host authorization callback sees it. */
function freezeJson(value: JsonValue): void {
  if (value === null || typeof value !== 'object') return;
  Object.values(value).forEach(child => freezeJson(child));
  Object.freeze(value);
}

function validRef(value: unknown): value is BlueprintRef {
  return isPlainRecord(value) && nonBlank(value.path) && nonBlank(value.version);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Clone and strictly validate JSON without accepting functions, circular data, or NaN. */
function cloneJson(value: unknown, context: string): JsonValue {
  const seen = new Set<object>();
  const walk = (item: unknown, depth: number): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!Array.isArray(item) && !isPlainRecord(item)) {
      throw new PixieAgentError('invalid_json', `${context} contains a non-JSON value`);
    }
    if (depth >= MAX_JSON_DEPTH) {
      throw new PixieAgentError('output_too_deep', `${context} exceeds JSON nesting limit`);
    }
    if (seen.has(item)) throw new PixieAgentError('invalid_json', `${context} contains a cycle`);
    seen.add(item);
    if (Object.getOwnPropertySymbols(item).length) {
      throw new PixieAgentError('invalid_json', `${context} contains symbol properties`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Object.keys(descriptors).filter(key => !Array.isArray(item) || key !== 'length');
    if (Array.isArray(item) && (Object.getPrototypeOf(item) !== Array.prototype
      || keys.length !== item.length || keys.some(key => !/^(0|[1-9]\d*)$/.test(key)
        || Number(key) >= item.length))) {
      throw new PixieAgentError('invalid_json', `${context} contains a non-JSON array`);
    }
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new PixieAgentError('invalid_json', `${context} contains an accessor or hidden property`);
      }
      walk(descriptor.value, depth + 1);
    }
    seen.delete(item);
  };
  walk(value, 0);
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new PixieAgentError('invalid_json', `${context} is not JSON`);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_JSON_BYTES) {
    throw new PixieAgentError('output_too_large', `${context} exceeds JSON size limit`);
  }
  return JSON.parse(encoded) as JsonValue;
}
