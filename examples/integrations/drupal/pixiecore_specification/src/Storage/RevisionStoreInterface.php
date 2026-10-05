<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Storage;

/**
 * Defines user-owned, append-only specification and execution persistence.
 */
interface RevisionStoreInterface {

  /**
   * Returns the user's latest saved revision, or NULL before the first Save.
   */
  public function latest(int $uid): ?array;

  /**
   * Saves a revision if the expected previous revision is still current.
   */
  public function save(int $uid, int $expectedRevision, string $instruction, string $blueprint, string $inputsJson): array;

  /**
   * Records a sanitized execution result for its original revision.
   */
  public function record(int $uid, array $revision, array $record): void;

  /**
   * Returns the user's most recent execution record, or NULL.
   */
  public function latestRun(int $uid): ?array;

}
