/**
 * Provides contracts bootstrapping behavior for PixieCore.
 */

import type {
  DistributionSignature,
  DistributionSignatureStatus,
} from '../distribution-signatures.js';

export const BLUEPRINT_PACKAGE_FILENAME = 'pixiecore.blueprint-package.json';
export const BLUEPRINT_PACKAGE_STATE_SCHEMA = 'pixiecore.blueprint-packages/v1' as const;
export const DEFAULT_BLUEPRINT_PACKAGE_STATE_FILENAME = 'pixiecore.blueprints.yml';
export const DEFAULT_BLUEPRINT_PACKAGE_DIRECTORY = 'blueprints/packages';
export const CURRENT_POP_VERSION = '0.1.0';

/**
 * Describes the blueprint package metadata contract.
 */
export interface BlueprintPackageMetadata {
  readonly schema: 'pixiecore.blueprint-package/v1';
  readonly package: {
    readonly name: string;
    readonly namespace: string;
    readonly version: string;
    readonly license: string;
  };
  readonly compatibility: {
    readonly pop: string;
    readonly pixiecore?: string;
  };
  readonly blueprints: readonly {
    readonly id: string;
    readonly version: string;
    readonly path: string;
  }[];
  readonly files: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly provenance?: BlueprintPackageProvenance;
  readonly signature?: DistributionSignature;
}

/**
 * Describes the blueprint package provenance contract.
 */
export interface BlueprintPackageProvenance {
  readonly source?: string;
  readonly commit?: string;
}

/**
 * Describes the verified blueprint package contract.
 */
export interface VerifiedBlueprintPackage {
  readonly rootPath: string;
  readonly metadata: BlueprintPackageMetadata;
  readonly signature: DistributionSignatureStatus;
}

/**
 * Describes the blueprint package state entry contract.
 */
export interface BlueprintPackageStateEntry {
  readonly active: string;
  readonly enabled: boolean;
  readonly installed: readonly string[];
  readonly history: readonly string[];
  readonly publisherKeyId?: string;
}

/**
 * Describes the blueprint package state contract.
 */
export interface BlueprintPackageState {
  readonly schema: typeof BLUEPRINT_PACKAGE_STATE_SCHEMA;
  readonly configPath: string;
  readonly packagesRoot: string;
  readonly packages: Readonly<Record<string, BlueprintPackageStateEntry>>;
}

/**
 * Configures blueprint package install behavior.
 */
export interface BlueprintPackageInstallOptions {
  readonly source: string;
  readonly configPath: string;
  readonly pixiecoreVersion: string;
  readonly popVersion?: string;
  readonly enable?: boolean;
  readonly publicKeyPath?: string;
  readonly requireSignature?: boolean;
}

/**
 * Describes the result of blueprint package install.
 */
export interface BlueprintPackageInstallResult {
  readonly name: string;
  readonly version: string;
  readonly path: string;
  readonly enabled: boolean;
  readonly operation: 'install' | 'upgrade';
  readonly signature: DistributionSignatureStatus;
}

/**
 * Describes the mutable blueprint package state entry contract.
 */
export interface MutableBlueprintPackageStateEntry {
  active: string;
  enabled: boolean;
  installed: string[];
  history: string[];
  publisherKeyId?: string;
}

/**
 * Describes the mutable blueprint package state contract.
 */
export interface MutableBlueprintPackageState {
  packages: Record<string, MutableBlueprintPackageStateEntry>;
}
