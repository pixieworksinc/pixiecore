import type { PublicSnapshotFile, PublicSnapshotFinding } from './scan.mjs';

export interface PreparePublicSnapshotOptions {
  readonly repositoryRoot?: string;
  readonly outputDirectory: string;
  readonly reportPath: string;
  readonly sourceRef?: string;
}

export interface PublicSnapshotAudit {
  readonly schema: 'pixiecore.public-source-snapshot-audit/v1';
  readonly source_commit: string;
  readonly generated_at: string;
  readonly public_file_count: number;
  readonly public_bytes: number;
  readonly excluded_files: readonly string[];
  readonly files: readonly PublicSnapshotFile[];
  readonly findings: readonly PublicSnapshotFinding[];
}

export function preparePublicSnapshot(
  options: PreparePublicSnapshotOptions,
): Promise<PublicSnapshotAudit>;
export function selectPublicSnapshotFiles(trackedFiles: readonly string[]): readonly string[];
