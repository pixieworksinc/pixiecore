<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Blueprint;

/**
 * Defines validation for the editable customer-discount Blueprint.
 */
interface DiscountBlueprintInterface {

  /**
   * Returns the complete initial Blueprint YAML.
   */
  public function defaultBlueprint(): string;

  /**
   * Validates and returns a complete Blueprint YAML document unchanged.
   */
  public function build(string $blueprintYaml): string;

  /**
   * Validates and decodes the permitted synthetic business inputs.
   *
   * @return array<string, mixed>
   *   Validated pricing inputs.
   */
  public function inputs(string $json): array;

  /**
   * Checks schema and arithmetic without manufacturing a runtime result.
   */
  public function validateResult(array $result, array $inputs): void;

}
