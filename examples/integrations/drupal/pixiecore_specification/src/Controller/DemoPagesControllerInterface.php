<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Controller;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Renders anonymous demo pages without invoking a provider.
 */
interface DemoPagesControllerInterface {

  /**
   * Builds the demo landing page.
   */
  public function landing(): array;

  /**
   * Builds the primary Agent page using trusted deployment settings.
   */
  public function replay(Request $request): array|Response;

  /**
   * Builds the saved six-case replay independently of the primary mode.
   */
  public function savedReplay(): array;

}
