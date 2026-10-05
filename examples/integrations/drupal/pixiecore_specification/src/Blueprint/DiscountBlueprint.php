<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Blueprint;

use Drupal\Component\Serialization\Yaml;

/**
 * Validates and preserves the complete editable Blueprint document.
 */
final class DiscountBlueprint implements DiscountBlueprintInterface {

  /**
   * Maximum editable Blueprint size in bytes.
   */
  public const MAX_BLUEPRINT_BYTES = 8192;

  /**
   * Maximum synthetic input size in bytes.
   */
  public const MAX_INPUT_BYTES = 2048;

  /**
   * Initial business inputs, not runtime configuration.
   */
  public const DEFAULT_INPUTS = '{"customer_tier":"Gold","purchase_amount":1200}';

  /**
   * {@inheritdoc}
   */
  public function defaultBlueprint(): string {
    return $this->loadBundledBlueprint();
  }

  /**
   * {@inheritdoc}
   */
  public function build(string $blueprintYaml): string {
    if (trim($blueprintYaml) === '' || strlen($blueprintYaml) > self::MAX_BLUEPRINT_BYTES) {
      throw new \InvalidArgumentException('Blueprint must contain 1 to 8192 bytes.');
    }
    try {
      $blueprint = Yaml::decode($blueprintYaml);
    }
    catch (\Throwable) {
      throw new \InvalidArgumentException('Blueprint must be valid YAML.');
    }
    if (!is_array($blueprint)) {
      throw new \InvalidArgumentException('Blueprint must be a YAML mapping.');
    }
    $required = ['name', 'version', 'role', 'input_placeholders', 'input_schema', 'prompt', 'output_schema'];
    foreach ($required as $key) {
      if (!array_key_exists($key, $blueprint)) {
        throw new \InvalidArgumentException('Blueprint is missing a required field: ' . $key . '.');
      }
    }
    if (!is_string($blueprint['name']) || trim($blueprint['name']) === ''
      || !is_string($blueprint['version']) || !preg_match('/^\d+\.\d+(?:\.\d+)?$/', $blueprint['version'])
      || !is_string($blueprint['role']) || trim($blueprint['role']) === ''
      || !is_string($blueprint['prompt']) || trim($blueprint['prompt']) === '') {
      throw new \InvalidArgumentException('Blueprint name, version, role, and prompt must be valid nonempty values.');
    }
    // Match the runtime's Mustache and legacy single-brace reference grammar.
    $references = preg_match_all('/\{\{[ \t]*([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*\}\}|\{[ \t]*([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*\}/u', $blueprint['prompt'], $matches, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    if ($references === FALSE) {
      throw new \InvalidArgumentException('Blueprint prompt contains invalid references.');
    }
    foreach ($matches as $match) {
      if (!in_array($match[1] ?? $match[2], ['customer_tier', 'purchase_amount'], TRUE)) {
        throw new \InvalidArgumentException('Blueprint prompt references an undeclared input.');
      }
    }
    $allowed = [
      'name',
      'version',
      'role',
      'temperature',
      'input_placeholders',
      'input_schema',
      'prompt',
      'output_schema',
      'examples',
      'model',
    ];
    if (array_diff(array_keys($blueprint), $allowed) !== []) {
      throw new \InvalidArgumentException('Blueprint contains unsupported fields.');
    }
    if (!is_array($blueprint['input_placeholders']) || count($blueprint['input_placeholders']) !== 2
      || array_column($blueprint['input_placeholders'], 'name') !== ['customer_tier', 'purchase_amount']) {
      throw new \InvalidArgumentException('Blueprint must declare customer_tier and purchase_amount inputs in order.');
    }
    foreach ($blueprint['input_placeholders'] as $index => $placeholder) {
      $expectedType = $index === 0 ? 'string' : 'number';
      if (!$this->hasOnlyKeys($placeholder, ['name', 'type', 'required', 'description'])
        || ($placeholder['type'] ?? NULL) !== $expectedType
        || ($placeholder['required'] ?? NULL) !== TRUE
        || (array_key_exists('description', $placeholder) && !is_string($placeholder['description']))) {
        throw new \InvalidArgumentException('Blueprint inputs must be required string and number values.');
      }
    }
    $inputProperties = $blueprint['input_schema']['properties'] ?? NULL;
    $outputProperties = $blueprint['output_schema']['properties'] ?? NULL;
    $inputKeys = is_array($inputProperties) ? array_keys($inputProperties) : [];
    $outputKeys = is_array($outputProperties) ? array_keys($outputProperties) : [];
    sort($inputKeys);
    sort($outputKeys);
    if (!$this->hasOnlyKeys($blueprint['input_schema'], ['type', 'additionalProperties', 'required', 'properties'])
      || ($blueprint['input_schema']['type'] ?? NULL) !== 'object'
      || ($blueprint['input_schema']['additionalProperties'] ?? NULL) !== FALSE
      || ($blueprint['input_schema']['required'] ?? NULL) !== ['customer_tier', 'purchase_amount']
      || $inputKeys !== ['customer_tier', 'purchase_amount']
      || !$this->hasOnlyKeys($inputProperties['customer_tier'] ?? NULL, ['type', 'minLength', 'maxLength', 'pattern'])
      || !$this->hasOnlyKeys($inputProperties['purchase_amount'] ?? NULL, ['type', 'minimum', 'maximum'])
      || ($inputProperties['customer_tier']['type'] ?? NULL) !== 'string'
      || ($inputProperties['customer_tier']['minLength'] ?? NULL) !== 1
      || ($inputProperties['customer_tier']['maxLength'] ?? NULL) !== 40
      || ($inputProperties['customer_tier']['pattern'] ?? NULL) !== '\\S'
      || ($inputProperties['purchase_amount']['type'] ?? NULL) !== 'number'
      || ($inputProperties['purchase_amount']['minimum'] ?? NULL) !== 0
      || ($inputProperties['purchase_amount']['maximum'] ?? NULL) !== 1000000
      || !$this->hasOnlyKeys($blueprint['output_schema'], ['type', 'additionalProperties', 'required', 'properties'])
      || ($blueprint['output_schema']['type'] ?? NULL) !== 'object'
      || ($blueprint['output_schema']['additionalProperties'] ?? NULL) !== FALSE
      || ($blueprint['output_schema']['required'] ?? NULL) !== ['discount', 'final_price']
      || $outputKeys !== ['discount', 'final_price']
      || !$this->hasOnlyKeys($outputProperties['discount'] ?? NULL, ['type', 'minimum', 'maximum'])
      || !$this->hasOnlyKeys($outputProperties['final_price'] ?? NULL, ['type', 'minimum'])
      || ($outputProperties['discount']['type'] ?? NULL) !== 'number'
      || ($outputProperties['discount']['minimum'] ?? NULL) !== 0
      || ($outputProperties['discount']['maximum'] ?? NULL) !== 1
      || ($outputProperties['final_price']['type'] ?? NULL) !== 'number'
      || ($outputProperties['final_price']['minimum'] ?? NULL) !== 0) {
      throw new \InvalidArgumentException('Blueprint input and output schemas do not match the demo contract.');
    }
    if (array_key_exists('temperature', $blueprint) && ((!is_int($blueprint['temperature']) && !is_float($blueprint['temperature']))
      || !is_finite((float) $blueprint['temperature']) || $blueprint['temperature'] < 0 || $blueprint['temperature'] > 2)
      || array_key_exists('model', $blueprint) && (!is_string($blueprint['model']) || trim($blueprint['model']) === '')) {
      throw new \InvalidArgumentException('Blueprint model settings are invalid.');
    }
    if (array_key_exists('examples', $blueprint)) {
      if (!is_array($blueprint['examples']) || !array_is_list($blueprint['examples'])) {
        throw new \InvalidArgumentException('Blueprint examples must be a sequence.');
      }
      foreach ($blueprint['examples'] as $example) {
        if (!is_array($example) || !is_array($example['input'] ?? NULL) || !is_array($example['output'] ?? NULL)) {
          throw new \InvalidArgumentException('Each Blueprint example must declare input and output mappings.');
        }
        try {
          $exampleInputs = $this->inputs(json_encode($example['input'], JSON_THROW_ON_ERROR));
          $this->validateResult($example['output'], $exampleInputs);
        }
        catch (\Throwable) {
          throw new \InvalidArgumentException('Blueprint examples must satisfy the input and arithmetic contracts.');
        }
      }
    }
    return $blueprintYaml;
  }

  /**
   * {@inheritdoc}
   */
  public function inputs(string $json): array {
    if (strlen($json) > self::MAX_INPUT_BYTES) {
      throw new \InvalidArgumentException('Inputs exceed the 2048 byte limit.');
    }
    try {
      $value = json_decode($json, FALSE, 16, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException) {
      throw new \InvalidArgumentException('Inputs must be a JSON object.');
    }
    if (!$value instanceof \stdClass) {
      throw new \InvalidArgumentException('Inputs must be a JSON object.');
    }
    $inputs = (array) $value;
    $keys = array_keys($inputs);
    sort($keys);
    if ($keys !== ['customer_tier', 'purchase_amount']) {
      throw new \InvalidArgumentException('Only customer_tier and purchase_amount are permitted.');
    }
    $tier = $inputs['customer_tier'];
    $amount = $inputs['purchase_amount'];
    // Match the JSON Schema \S check, including non-ASCII separators and BOM.
    $hasNonWhitespace = is_string($tier)
      && preg_match('/[^\p{Z}\x{0009}-\x{000D}\x{FEFF}]/u', $tier) === 1;
    // JSON Schema string lengths count UTF-16 code units, not code points.
    $length = $hasNonWhitespace
      ? intdiv(strlen(mb_convert_encoding($tier, 'UTF-16LE', 'UTF-8')), 2) : 0;
    if (!$hasNonWhitespace || $length > 40) {
      throw new \InvalidArgumentException('customer_tier must be a nonempty string of at most 40 characters.');
    }
    if ((!is_int($amount) && !is_float($amount)) || !is_finite((float) $amount) || $amount < 0 || $amount > 1000000) {
      throw new \InvalidArgumentException('purchase_amount must be a finite number from 0 to 1000000.');
    }
    return $inputs;
  }

  /**
   * {@inheritdoc}
   */
  public function validateResult(array $result, array $inputs): void {
    $keys = array_keys($result);
    sort($keys);
    if ($keys !== ['discount', 'final_price']) {
      throw new \UnexpectedValueException('Output fields do not match the contract.');
    }
    foreach ($result as $number) {
      if ((!is_int($number) && !is_float($number)) || !is_finite((float) $number)) {
        throw new \UnexpectedValueException('Output values must be finite numbers.');
      }
    }
    if ($result['discount'] < 0 || $result['discount'] > 1 || $result['final_price'] < 0) {
      throw new \UnexpectedValueException('Output numbers are outside the contract.');
    }
    $expected = $inputs['purchase_amount'] * (1 - $result['discount']);
    if (abs($expected - $result['final_price']) > 0.000001) {
      throw new \UnexpectedValueException('Output arithmetic is inconsistent.');
    }
  }

  /**
   * Rejects uninspected schema keywords in the fixed demo contract.
   */
  private function hasOnlyKeys(mixed $value, array $allowed): bool {
    return is_array($value)
      && array_diff(array_keys($value), $allowed) === [];
  }

  /**
   * Loads the bundled contract, never a path supplied by a caller.
   */
  private function loadBundledBlueprint(): string {
    $path = dirname(__DIR__, 2) . '/blueprints/customer-discount/customer-discount.yaml';
    $source = file_get_contents($path);
    if ($source === FALSE) {
      throw new \RuntimeException('The bundled Blueprint is unavailable.');
    }
    return $source;
  }

}
