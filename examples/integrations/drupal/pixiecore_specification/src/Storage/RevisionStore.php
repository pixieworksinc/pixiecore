<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Storage;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Database\Connection;

/**
 * Stores immutable revisions using Drupal's SQLite-compatible Database API.
 */
final class RevisionStore implements RevisionStoreInterface {

  /**
   * Constructs the store with the site's database and clock.
   */
  public function __construct(
    private readonly Connection $database,
    private readonly TimeInterface $time,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function latest(int $uid): ?array {
    $row = $this->database->select('pixiecore_spec_revision', 'r')
      ->fields('r')->condition('uid', $uid)->orderBy('revision', 'DESC')
      ->range(0, 1)->execute()->fetchAssoc();
    if (!$row) {
      return NULL;
    }
    $row['revision'] = (int) $row['revision'];
    return $row;
  }

  /**
   * {@inheritdoc}
   */
  public function save(int $uid, int $expectedRevision, string $instruction, string $blueprint, string $inputsJson): array {
    if ($uid <= 0 || $expectedRevision < 0) {
      throw new \InvalidArgumentException('An authenticated owner and valid revision are required.');
    }
    $transaction = $this->database->startTransaction();
    try {
      $current = $this->latest($uid);
      if (($current['revision'] ?? 0) !== $expectedRevision) {
        throw new \RuntimeException('The specification changed. Reload before saving.');
      }
      $row = [
        'uid' => $uid,
        'revision' => $expectedRevision + 1,
        'source_hash' => hash('sha256', $blueprint),
        'instruction' => $instruction,
        'blueprint' => $blueprint,
        'inputs_json' => $inputsJson,
        'created' => $this->time->getCurrentTime(),
      ];
      $this->database->insert('pixiecore_spec_revision')->fields($row)->execute();
      return $row;
    }
    catch (\Throwable $error) {
      $transaction->rollBack();
      throw $error;
    }
  }

  /**
   * {@inheritdoc}
   */
  public function record(int $uid, array $revision, array $record): void {
    $this->database->insert('pixiecore_spec_run')->fields([
      'uid' => $uid,
      'revision' => $revision['revision'],
      'source_hash' => $revision['source_hash'],
      'record' => json_encode($record, JSON_THROW_ON_ERROR),
      'created' => $this->time->getCurrentTime(),
    ])->execute();
  }

  /**
   * {@inheritdoc}
   */
  public function latestRun(int $uid): ?array {
    $row = $this->database->select('pixiecore_spec_run', 'r')
      ->fields('r')->condition('uid', $uid)->orderBy('id', 'DESC')
      ->range(0, 1)->execute()->fetchAssoc();
    if (!$row) {
      return NULL;
    }
    return json_decode($row['record'], TRUE, 32, JSON_THROW_ON_ERROR);
  }

}
