/**
 * Implements executor behavior for the jit plugin.
 */

import type {
  JitExecutionEvent,
  JitExecutionPort,
  JitExecutorOptions,
  JitPromotionFile,
} from '../../../core/contracts/jit/index.js';
import type { Blueprint } from '../../../core/contracts/types/index.js';
import { runJitProgram } from './program.js';
import {
  blueprintDigest,
  promotionFileIdentity,
  readJitPromotionFile,
} from './promotions.js';

interface LoadedArtifact {
  readonly identity: string;
  readonly file?: JitPromotionFile;
  readonly reason?: 'artifact_unavailable' | 'artifact_invalid';
}

/**
 * Creates jit executor after validating the supplied contract.
 */
export function createJitExecutor(options: JitExecutorOptions): JitExecutionPort {
  if (!options || typeof options.promotionsPath !== 'string' || options.promotionsPath.trim() === '') {
    throw new TypeError('promotionsPath must be a non-blank string');
  }
  let loaded: LoadedArtifact | undefined;

  return Object.freeze({
    /** Executes an admitted promotion or returns a value-free fallback decision. */
    async execute(
      blueprint: Readonly<Blueprint>,
      inputs: Readonly<Record<string, unknown>>,
      model: string,
    ) {
      const artifact = await load(options.promotionsPath, loaded);
      loaded = artifact;
      if (!artifact.file) {
        fallback(options, blueprint, model, artifact.reason ?? 'artifact_invalid');
        return undefined;
      }
      const named = artifact.file.promotions.filter(item => (
        item.blueprint === blueprint.name && item.version === blueprint.version
      ));
      if (named.length === 0) {
        fallback(options, blueprint, model, 'promotion_missing');
        return undefined;
      }
      const currentSource = blueprintDigest(blueprint);
      const sourced = named.filter(item => item.source_digest === currentSource);
      if (sourced.length === 0) {
        fallback(options, blueprint, model, 'source_changed');
        return undefined;
      }
      const promotion = sourced.find(item => item.model === model);
      if (!promotion) {
        fallback(options, blueprint, model, 'model_changed');
        return undefined;
      }
      try {
        const output = runJitProgram(promotion.program, inputs);
        emit(options, {
          outcome: 'compiled',
          blueprint: blueprint.name,
          version: blueprint.version,
          model,
          artifact: promotion.artifact_digest,
        });
        return Object.freeze({ output, artifact: promotion.artifact_digest });
      } catch {
        fallback(options, blueprint, model, 'program_error');
        return undefined;
      }
    },
  });
}

async function load(path: string, current: LoadedArtifact | undefined): Promise<LoadedArtifact> {
  let identity: string;
  try {
    identity = await promotionFileIdentity(path);
  } catch {
    return { identity: 'unavailable', reason: 'artifact_unavailable' };
  }
  if (current?.identity === identity) return current;
  try {
    return { identity, file: await readJitPromotionFile(path) };
  } catch {
    return { identity, reason: 'artifact_invalid' };
  }
}

function fallback(
  options: JitExecutorOptions,
  blueprint: Readonly<Blueprint>,
  model: string,
  reason: Extract<JitExecutionEvent, { outcome: 'fallback' }>['reason'],
): void {
  emit(options, {
    outcome: 'fallback',
    blueprint: blueprint.name,
    version: blueprint.version,
    model,
    reason,
  });
}

function emit(options: JitExecutorOptions, event: JitExecutionEvent): void {
  try {
    options.onEvent?.(Object.freeze(event));
  } catch {
    // Observation must never change execution behavior.
  }
}
