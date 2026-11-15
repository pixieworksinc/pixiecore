<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Controller;

/**
 * Renders anonymous demo pages without invoking a provider.
 */
interface DemoPagesControllerInterface {

  /**
   * Builds the demo landing page.
   */
  public function landing(): array;

  /**
   * Builds the saved six-case replay page.
   */
  public function replay(): array;

}
