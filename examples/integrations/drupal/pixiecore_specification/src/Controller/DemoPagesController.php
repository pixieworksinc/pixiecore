<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Controller;

/**
 * Provides the landing and saved replay pages.
 */
final class DemoPagesController implements DemoPagesControllerInterface {

  /**
   * {@inheritdoc}
   */
  public function landing(): array {
    return [
      '#theme' => 'pixiecore_demo_landing',
      '#attached' => ['library' => ['pixiecore_specification/landing']],
      '#cache' => ['contexts' => ['route', 'theme']],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function replay(): array {
    $policy = "default-src 'none'; script-src 'self'; style-src 'self'; "
      . "img-src 'self' data:; font-src 'self'; connect-src 'none'; "
      . "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    return [
      '#theme' => 'pixiecore_demo_replay',
      '#attached' => [
        'library' => ['pixiecore_specification/replay'],
        'http_header' => [
          ['Content-Security-Policy', $policy, TRUE],
          ['X-Frame-Options', 'DENY', TRUE],
        ],
      ],
      '#cache' => ['contexts' => ['route', 'theme']],
    ];
  }

}
