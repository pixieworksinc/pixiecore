<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Adapter;

/**
 * Defines the fixed, offline customer adapter demonstration.
 */
interface CustomerAdapterDemoInterface {

  /**
   * Returns the bundled synthetic cases without executing the runtime.
   */
  public function cases(): array;

  /**
   * Returns the complete immutable Blueprint sent for every case.
   */
  public function blueprint(): string;

  /**
   * Executes one bundled case through the offline PixieCore HTTP boundary.
   */
  public function execute(string $caseId): array;

}
