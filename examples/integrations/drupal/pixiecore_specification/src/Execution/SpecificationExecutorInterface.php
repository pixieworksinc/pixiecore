<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Execution;

/**
 * Defines guarded save and execution operations for an authenticated owner.
 */
interface SpecificationExecutorInterface {

  /**
   * Saves validated instruction and inputs without making a provider request.
   */
  public function save(int $uid, int $revision, string $instruction, string $inputsJson): array;

  /**
   * Executes exactly the saved revision with validated synthetic inputs.
   */
  public function execute(int $uid, int $revision, string $instruction, string $inputsJson): array;

  /**
   * Returns the trusted backend mode without exposing its connection secrets.
   */
  public function mode(): string;

}
