<?php

declare(strict_types=1);

namespace Drupal\pixiecore_integration;

/**
 * Defines the authenticated, application-owned PixieCore HTTP boundary.
 */
interface PixieCoreClientInterface {

  /**
   * Executes one Blueprint and returns validated data.
   */
  public function execute(string $baseUrl, string $bearerToken, string $blueprintYaml, array $inputs): array;

  /**
   * Executes one Blueprint and preserves its response envelope.
   */
  public function executeEnvelope(string $baseUrl, string $bearerToken, string $blueprintYaml, array $inputs): array;

}
