export interface PublicSnapshotFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PublicSnapshotFinding {
  readonly rule: string;
  readonly path: string;
}

export interface PublicSnapshotScan {
  readonly files: readonly PublicSnapshotFile[];
  readonly findings: readonly PublicSnapshotFinding[];
  readonly excluded_prefixes: readonly string[];
  readonly excluded_paths: readonly string[];
}

export function scanPublicSnapshot(snapshotRoot: string): Promise<PublicSnapshotScan>;
export function assertPublicSnapshotClean(report: PublicSnapshotScan): void;
