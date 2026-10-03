import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { ConfigurationError, getConfig, PromptRuntime } from '../../src/index.js';
import { resolvePixieCorePackageRoot } from '../../src/core/bootstrap/config/package-root.js';
import { withEnvironment } from '../helpers/environment.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('configuration contract');

type NumericRuntimeOption =
  | 'temperature'
  | 'maxRetry'
  | 'requestTimeout'
  | 'maxToolRounds'
  | 'maxPayloadSize';

interface NumericConfigContract {
  readonly option: NumericRuntimeOption;
  readonly environmentVariable:
    | 'PROMPT_RUNTIME_TEMPERATURE'
    | 'PROMPT_RUNTIME_MAX_RETRY'
    | 'PROMPT_RUNTIME_REQUEST_TIMEOUT'
    | 'PROMPT_RUNTIME_MAX_TOOL_ROUNDS'
    | 'PROMPT_RUNTIME_MAX_PAYLOAD_SIZE';
  readonly minimum: number | undefined;
  readonly representative: number;
}

const NUMERIC_CONFIG_CONTRACTS = [
  {
    option: 'temperature',
    environmentVariable: 'PROMPT_RUNTIME_TEMPERATURE',
    minimum: undefined,
    representative: data.decimal('representative temperature', -1, 2, 3),
  },
  {
    option: 'maxRetry',
    environmentVariable: 'PROMPT_RUNTIME_MAX_RETRY',
    minimum: 0,
    representative: data.integer('representative max retry', 1, 12),
  },
  {
    option: 'requestTimeout',
    environmentVariable: 'PROMPT_RUNTIME_REQUEST_TIMEOUT',
    minimum: 1,
    representative: data.integer('representative request timeout', 2, 300),
  },
  {
    option: 'maxToolRounds',
    environmentVariable: 'PROMPT_RUNTIME_MAX_TOOL_ROUNDS',
    minimum: 0,
    representative: data.integer('representative max tool rounds', 1, 30),
  },
  {
    option: 'maxPayloadSize',
    environmentVariable: 'PROMPT_RUNTIME_MAX_PAYLOAD_SIZE',
    minimum: 1,
    representative: data.integer('representative max payload size', 2, 1_000_000),
  },
] as const satisfies readonly NumericConfigContract[];

test('configuration contract exposes stable defaults and environment values', () => {
  const defaults = getConfig({}, {});
  assert.deepEqual(defaults, {
    provider: 'openai', temperature: 0.7, maxRetry: 3, requestTimeout: 60,
    maxToolRounds: 10, maxPayloadSize: 102400, strictValidation: true, usePseudoToolCalling: false,
  });
  const configured = getConfig({}, {
    PROMPT_RUNTIME_PROVIDER: 'anthropic', PROMPT_RUNTIME_TEMPERATURE: '0.25',
    PROMPT_RUNTIME_MAX_RETRY: '5', PROMPT_RUNTIME_REQUEST_TIMEOUT: '120',
    PROMPT_RUNTIME_MAX_TOOL_ROUNDS: '8', PROMPT_RUNTIME_STRICT_VALIDATION: 'false',
    PROMPT_RUNTIME_MAX_PAYLOAD_SIZE: '204800',
    PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING: 'true', PROMPT_RUNTIME_TOOL_CHOICE: 'required',
    PROMPT_RUNTIME_MODEL: 'configured-model',
  });
  assert.deepEqual(configured, {
    provider: 'anthropic', temperature: 0.25, maxRetry: 5, requestTimeout: 120,
    maxToolRounds: 8, maxPayloadSize: 204800, strictValidation: false, usePseudoToolCalling: true,
    toolChoice: 'required', model: 'configured-model',
  });
});

test('constructor options override environment values', () => {
  const configured = getConfig({ provider: 'openai', temperature: 0.9, maxRetry: 2, requestTimeout: 30, maxToolRounds: 4, strictValidation: true, model: 'explicit' }, {
    PROMPT_RUNTIME_PROVIDER: 'anthropic', PROMPT_RUNTIME_TEMPERATURE: '0.1',
    PROMPT_RUNTIME_MAX_RETRY: '9', PROMPT_RUNTIME_STRICT_VALIDATION: 'false',
  });
  assert.equal(configured.provider, 'openai');
  assert.equal(configured.temperature, 0.9);
  assert.equal(configured.maxRetry, 2);
  assert.equal(configured.strictValidation, true);
  assert.equal(configured.model, 'explicit');
});

test('explicit .env files are loaded without mutating process.env', async () => {
  await withTempDirectory(async directory => {
    const path = join(directory, '.env');
    await writeFile(path, 'PROMPT_RUNTIME_TEMPERATURE=0.33\nPROMPT_RUNTIME_MAX_RETRY=7\n', 'utf8');
    await withEnvironment({ PROMPT_RUNTIME_ENV_FILE: path, PROMPT_RUNTIME_TEMPERATURE: undefined, PROMPT_RUNTIME_MAX_RETRY: undefined }, () => {
      const configured = getConfig();
      assert.equal(configured.temperature, 0.33);
      assert.equal(configured.maxRetry, 7);
      assert.equal(process.env.PROMPT_RUNTIME_TEMPERATURE, undefined);
    });
  });
});

test('invalid environment values fail explicitly', () => {
  assert.throws(() => getConfig({}, { PROMPT_RUNTIME_MAX_RETRY: 'three' }), ConfigurationError);
  assert.throws(() => getConfig({}, { PROMPT_RUNTIME_REQUEST_TIMEOUT: '0' }), ConfigurationError);
  assert.throws(() => getConfig({}, { PROMPT_RUNTIME_STRICT_VALIDATION: 'sometimes' }), ConfigurationError);
  assert.throws(() => getConfig({}, { PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING: 'sometimes' }), ConfigurationError);
  assert.throws(() => getConfig({}, { PROMPT_RUNTIME_TOOL_CHOICE: 'always' }), ConfigurationError);
  assert.throws(() => getConfig({}, { PROMPT_RUNTIME_MAX_PAYLOAD_SIZE: '0' }), ConfigurationError);
});

test('numeric constructor options accept the same documented ranges as environment values', async t => {
  for (const contract of NUMERIC_CONFIG_CONTRACTS) {
    await t.test(contract.option, () => {
      const acceptedValues = contract.minimum === undefined
        ? [contract.representative, Number.MAX_SAFE_INTEGER + 1]
        : [contract.minimum, contract.representative];

      for (const value of acceptedValues) {
        assert.equal(
          getConfig({}, numericEnvironment(contract, value))[contract.option],
          value,
        );
        assert.equal(
          getConfig(numericOverride(contract.option, value), {})[contract.option],
          value,
        );
      }
    });
  }
});

test('numeric constructor options reject every value rejected by the equivalent environment variable', async t => {
  for (const contract of NUMERIC_CONFIG_CONTRACTS) {
    const invalidCases = contract.minimum === undefined
      ? [
          { name: 'NaN', value: Number.NaN, message: `${contract.environmentVariable} must be a finite number` },
          { name: 'Infinity', value: Number.POSITIVE_INFINITY, message: `${contract.environmentVariable} must be a finite number` },
        ]
      : [
          {
            name: 'minimum minus one',
            value: contract.minimum - 1,
            message: `${contract.environmentVariable} must be at least ${contract.minimum}`,
          },
          { name: 'NaN', value: Number.NaN, message: `${contract.environmentVariable} must be an integer` },
          { name: 'Infinity', value: Number.POSITIVE_INFINITY, message: `${contract.environmentVariable} must be an integer` },
          { name: 'non-integer', value: contract.minimum + 0.5, message: `${contract.environmentVariable} must be an integer` },
          {
            name: 'unsafe integer',
            value: Number.MAX_SAFE_INTEGER + 1,
            message: `${contract.environmentVariable} must be at least ${contract.minimum}`,
          },
        ];

    for (const invalidCase of invalidCases) {
      await t.test(`${contract.option}: ${invalidCase.name}`, () => {
        assert.throws(
          () => getConfig({}, numericEnvironment(contract, invalidCase.value)),
          error => exactConfigurationError(error, invalidCase.message),
        );
        assert.throws(
          () => getConfig(numericOverride(contract.option, invalidCase.value), {}),
          error => exactConfigurationError(error, invalidCase.message),
        );
      });
    }
  }
});

test('runtime applies configured temperature and strict-validation mode', async () => {
  await withEnvironment({ PROMPT_RUNTIME_TEMPERATURE: '0.42', PROMPT_RUNTIME_STRICT_VALIDATION: 'false' }, async () => {
    const name = data.person('runtime name');
    const result = data.text('runtime result');
    const provider = new ScriptedProvider([{ content: JSON.stringify({ result }) }]);
    const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
    try {
      await runtime.executeYaml(`
name: Runtime config
version: '1.0'
role: assistant
prompt: Name {{ name }}
input_placeholders:
  - name: name
    type: string
    required: true
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`, { name, ignored: true });
      assert.equal(provider.calls[0]?.temperature, 0.42);
    } finally { await runtime.close(); }
  });
});

test('package-root discovery selects the nearest valid owning package', async () => {
  await withTempDirectory(async root => {
    const owningRoot = join(root, data.text('nearest owning directory', 'package'));
    const modulePath = join(
      owningRoot,
      data.text('nearest source directory', 'src'),
      data.text('nearest module file', 'module.ts'),
    );
    await mkdir(dirname(modulePath), { recursive: true });
    await Promise.all([
      writeFile(
        join(root, 'package.json'),
        JSON.stringify({ name: data.text('outer package name', 'package') }),
        'utf8',
      ),
      writeFile(join(owningRoot, 'package.json'), JSON.stringify({ name: '@pixieworks/pixiecore' }), 'utf8'),
    ]);

    assert.equal(resolvePixieCorePackageRoot(pathToFileURL(modulePath)), owningRoot);
  });
});

test('package-root discovery exposes the exact public error for the nearest wrong package name', async () => {
  await withTempDirectory(async root => {
    const nestedRoot = join(root, data.text('wrong package directory', 'package'));
    const modulePath = join(nestedRoot, data.text('wrong package module', 'module.ts'));
    const manifestPath = join(nestedRoot, 'package.json');
    const actualName = data.text('wrong package name', 'package');
    await mkdir(nestedRoot, { recursive: true });
    await Promise.all([
      writeFile(join(root, 'package.json'), JSON.stringify({ name: '@pixieworks/pixiecore' }), 'utf8'),
      writeFile(manifestPath, JSON.stringify({ name: actualName }), 'utf8'),
    ]);

    assert.throws(
      () => resolvePixieCorePackageRoot(pathToFileURL(modulePath)),
      error => exactConfigurationError(
        error,
        `Expected owning package "@pixieworks/pixiecore" but found "${actualName}" at ${manifestPath}`,
      ),
    );
  });
});

test('package-root discovery exposes malformed manifest syntax as the public error cause', async () => {
  await withTempDirectory(async root => {
    const packageRoot = join(root, data.text('malformed package directory', 'package'));
    const modulePath = join(packageRoot, data.text('malformed package module', 'module.ts'));
    const manifestPath = join(packageRoot, 'package.json');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(manifestPath, '{', 'utf8');

    assert.throws(
      () => resolvePixieCorePackageRoot(pathToFileURL(modulePath)),
      error => exactConfigurationError(
        error,
        `Invalid PixieCore package manifest: ${manifestPath}`,
        cause => cause instanceof SyntaxError,
      ),
    );
  });
});

test('package-root discovery exposes unreadable manifests when permissions are enforceable', async t => {
  await withTempDirectory(async root => {
    const packageRoot = join(root, data.text('unreadable package directory', 'package'));
    const modulePath = join(packageRoot, data.text('unreadable package module', 'module.ts'));
    const manifestPath = join(packageRoot, 'package.json');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ name: '@pixieworks/pixiecore' }), 'utf8');

    try {
      await chmod(manifestPath, 0o000);
    } catch {
      t.skip('This platform cannot remove package manifest read permissions');
      return;
    }

    try {
      const deniedCode = await permissionDeniedCode(manifestPath);
      if (deniedCode === undefined) {
        t.skip('This process can read permission-free package manifests');
        return;
      }
      assert.throws(
        () => resolvePixieCorePackageRoot(pathToFileURL(modulePath)),
        error => exactConfigurationError(
          error,
          `Failed to read PixieCore package manifest: ${manifestPath}`,
          cause => isSystemError(cause) && cause.code === deniedCode,
        ),
      );
    } finally {
      await chmod(manifestPath, 0o600);
    }
  });
});

test('package-root discovery reports a missing boundary without falling back to cwd', async () => {
  await withTempDirectory(async root => {
    const cwdManifest = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    assert.equal(cwdManifest.name, '@pixieworks/pixiecore');
    const modulePath = join(
      root,
      data.text('missing boundary directory', 'source'),
      data.text('missing boundary module', 'module.ts'),
    );
    await mkdir(dirname(modulePath), { recursive: true });

    assert.throws(
      () => resolvePixieCorePackageRoot(pathToFileURL(modulePath)),
      error => exactConfigurationError(
        error,
        `Could not find the owning PixieCore package from ${modulePath}`,
      ),
    );
  });
});

function exactConfigurationError(
  error: unknown,
  message: string,
  validateCause: (cause: unknown) => boolean = cause => cause === undefined,
): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.constructor, ConfigurationError);
  const configurationError = error as ConfigurationError;
  assert.equal(configurationError.name, 'ConfigurationError');
  assert.equal(configurationError.code, 'configuration_error');
  assert.equal(configurationError.message, message);
  assert.ok(validateCause(configurationError.cause));
  return true;
}

function numericEnvironment(
  contract: NumericConfigContract,
  value: number,
): NodeJS.ProcessEnv {
  return { [contract.environmentVariable]: String(value) };
}

function numericOverride(
  option: NumericRuntimeOption,
  value: number,
): Parameters<typeof getConfig>[0] {
  return { [option]: value };
}

async function permissionDeniedCode(path: string): Promise<string | undefined> {
  try {
    await readFile(path, 'utf8');
    return undefined;
  } catch (error) {
    assert.ok(isSystemError(error));
    assert.ok(error.code === 'EACCES' || error.code === 'EPERM');
    return error.code;
  }
}

function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}
