import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PromptRuntime, type RuntimeOptions } from '@pixieworks/pixiecore';
import {
  composePublicationBrief,
  type PublicationBriefInput,
  type PublicationBriefResult,
} from '../../application-composition/publication-brief.js';

export type PublicationBriefApproach = 'monolithic' | 'composed';

export interface PublicationBriefComparisonOptions {
  readonly runtimeOptions?: (approach: PublicationBriefApproach) => RuntimeOptions;
  readonly signal?: AbortSignal;
}

export interface PublicationBriefComparisonResult {
  readonly input: Readonly<PublicationBriefInput>;
  readonly monolithic: PublicationBriefResult;
  readonly composed: PublicationBriefResult;
  readonly structure: {
    readonly monolithic: {
      readonly blueprint_executions: 1;
      readonly independently_testable_units: 1;
      readonly cognitive_operations: 5;
    };
    readonly composed: {
      readonly blueprint_executions: 5;
      readonly independently_testable_units: 5;
      readonly cognitive_operations: 5;
    };
  };
}

const monolithicBlueprintPath = fileURLToPath(new URL(
  './monolithic-publication-brief.yaml',
  import.meta.url,
));

/** Executes the same publication-brief input through both comparison shapes. */
export async function comparePublicationBriefApproaches(
  input: PublicationBriefInput,
  options: PublicationBriefComparisonOptions = {},
): Promise<PublicationBriefComparisonResult> {
  const runtimeOptions = options.runtimeOptions ?? (() => ({}));
  await using monolithicRuntime = new PromptRuntime(runtimeOptions('monolithic'));
  const monolithic = await monolithicRuntime.execute(
    monolithicBlueprintPath,
    { source_text: input.sourceText, locale: input.locale },
    options.signal === undefined ? {} : { signal: options.signal },
  ) as unknown as PublicationBriefResult;
  const composed = await composePublicationBrief(input, {
    runtimeOptions: runtimeOptions('composed'),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  return deepFreeze({
    input: { ...input },
    monolithic: structuredClone(monolithic),
    composed,
    structure: {
      monolithic: {
        blueprint_executions: 1,
        independently_testable_units: 1,
        cognitive_operations: 5,
      },
      composed: {
        blueprint_executions: 5,
        independently_testable_units: 5,
        cognitive_operations: 5,
      },
    },
  });
}

function deepFreeze<Value extends object>(value: Value): Value {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceText = process.env.PIXIECORE_COMPARISON_SOURCE?.trim();
  if (!sourceText) throw new TypeError('PIXIECORE_COMPARISON_SOURCE must be non-blank');
  const result = await comparePublicationBriefApproaches({
    sourceText,
    locale: process.env.PIXIECORE_COMPARISON_LOCALE?.trim() || 'en-US',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
