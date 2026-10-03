/**
 * Coordinates packages responsibilities inside the PixieCore kernel.
 */

export {
  BLUEPRINT_PACKAGE_FILENAME,
  BLUEPRINT_PACKAGE_STATE_SCHEMA,
  CURRENT_POP_VERSION,
  DEFAULT_BLUEPRINT_PACKAGE_DIRECTORY,
  DEFAULT_BLUEPRINT_PACKAGE_STATE_FILENAME,
  installBlueprintPackage,
  readBlueprintPackageState,
  resolveEnabledBlueprintPackages,
  rollbackBlueprintPackage,
  setBlueprintPackageProvenance,
  setBlueprintPackageEnabled,
  signBlueprintPackage,
  upgradeBlueprintPackage,
  verifyBlueprintPackage,
} from '../../bootstrap/blueprint/manager.js';
export type {
  BlueprintPackageInstallOptions,
  BlueprintPackageInstallResult,
  BlueprintPackageMetadata,
  BlueprintPackageProvenance,
  BlueprintPackageState,
  BlueprintPackageStateEntry,
  VerifiedBlueprintPackage,
} from '../../bootstrap/blueprint/manager.js';
export type {
  DistributionSignature,
  DistributionSignatureStatus,
} from '../../bootstrap/distribution-signatures.js';
