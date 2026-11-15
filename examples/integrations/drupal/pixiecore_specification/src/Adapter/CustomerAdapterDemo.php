<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Adapter;

use Drupal\Core\Site\Settings;
use Drupal\pixiecore_integration\PixieCoreClientInterface;

/**
 * Sends unparsed fixture text to one immutable adapter Blueprint.
 */
final class CustomerAdapterDemo implements CustomerAdapterDemoInterface {

  /**
   * Constructs the demo without reading provider credentials or trial state.
   */
  public function __construct(
    private readonly PixieCoreClientInterface $client,
    private readonly Settings $settings,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function cases(): array {
    $path = __DIR__ . '/../../blueprints/customer-adapter/cases.json';
    try {
      $cases = json_decode(file_get_contents($path) ?: '', TRUE, 32, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException) {
      throw new \RuntimeException('The bundled adapter cases are unavailable.');
    }
    if (!is_array($cases) || !array_is_list($cases) || count($cases) !== 5) {
      throw new \RuntimeException('The bundled adapter cases are invalid.');
    }
    $indexed = [];
    foreach ($cases ?: [] as $case) {
      if (!is_array($case)
        || !is_string($case['id'] ?? NULL)
        || !in_array($case['id'], ['json', 'csv', 'text', 'missing', 'ambiguous'], TRUE)
        || isset($indexed[$case['id']])
        || !is_string($case['label'] ?? NULL)
        || trim($case['label']) === ''
        || !is_array($case['inputs'] ?? NULL)
        || array_diff(array_keys($case['inputs']), ['source_format', 'source_text'])
        || !in_array($case['inputs']['source_format'] ?? NULL, ['json', 'csv', 'text'], TRUE)
        || !is_string($case['inputs']['source_text'] ?? NULL)
        || trim($case['inputs']['source_text']) === ''
        || strlen($case['inputs']['source_text']) > 4096
        || !is_array($case['expected'] ?? NULL)
        || !$this->validResult($case['expected'])) {
        throw new \RuntimeException('The bundled adapter cases are invalid.');
      }
      $indexed[$case['id']] = $case;
    }
    return $indexed;
  }

  /**
   * {@inheritdoc}
   */
  public function blueprint(): string {
    $path = __DIR__ . '/../../blueprints/customer-adapter/customer-adapter.yaml';
    $source = file_get_contents($path);
    if (!is_string($source) || trim($source) === '' || strlen($source) > 16_384) {
      throw new \RuntimeException('The bundled adapter Blueprint is unavailable.');
    }
    return $source;
  }

  /**
   * {@inheritdoc}
   */
  public function execute(string $caseId): array {
    $case = $this->cases()[$caseId] ?? NULL;
    if ($case === NULL) {
      throw new \InvalidArgumentException('Select a bundled adapter case.');
    }
    $source = $this->blueprint();
    $endpoint = $this->endpoint();
    $record = [
      'case_id' => $caseId,
      'inputs' => $case['inputs'],
      'blueprint_sha256' => hash('sha256', $source),
      'mode' => 'fixture',
      'status' => 'failed',
      'schema_validation' => 'not_checked',
      'expected_match' => 'not_checked',
      'model_accuracy' => 'not_measured',
      'http_requests' => 1,
    ];
    try {
      $response = $this->client->executeEnvelope($endpoint, '', $source, $case['inputs']);
      if (($response['metadata']['provider'] ?? NULL) !== 'adapter-fixture'
        || ($response['metadata']['model'] ?? NULL) !== 'offline-contract-fixtures') {
        throw new \UnexpectedValueException('Unexpected adapter provider.');
      }
      $data = $response['data'] ?? NULL;
      if (!is_array($data) || !$this->validResult($data)) {
        $record['schema_validation'] = 'failed';
        throw new \UnexpectedValueException('Invalid adapter result.');
      }
      $record['schema_validation'] = 'passed';
      // Compare independent fixture expectations only after validating types.
      $record['expected_match'] = $data == $case['expected'] ? 'passed' : 'failed';
      if ($record['expected_match'] !== 'passed') {
        throw new \UnexpectedValueException('Adapter result differs from the fixture.');
      }
      $record['data'] = $data;
      $record['provider'] = $response['metadata']['provider'];
      $record['model'] = $response['metadata']['model'];
      $record['status'] = !empty($data['error']) ? 'review_required' : 'passed';
    }
    catch (\Throwable) {
      // Do not expose backend exceptions, raw bodies or transport settings.
      $record['failure'] = 'The offline runtime request or result validation failed.';
    }
    return $record;
  }

  /**
   * Accepts only a credential-free loopback fixture endpoint.
   */
  private function endpoint(): string {
    $options = $this->settings->get('pixiecore_adapter', []);
    $endpoint = is_array($options) ? ($options['endpoint'] ?? NULL) : NULL;
    if (!is_string($endpoint) || !filter_var($endpoint, FILTER_VALIDATE_URL)
      || parse_url($endpoint, PHP_URL_SCHEME) !== 'http'
      || !in_array(parse_url($endpoint, PHP_URL_HOST), ['localhost', '127.0.0.1', '[::1]'], TRUE)
      || !in_array(parse_url($endpoint, PHP_URL_PATH), [NULL, '', '/'], TRUE)
      || parse_url($endpoint, PHP_URL_USER) !== NULL
      || parse_url($endpoint, PHP_URL_PASS) !== NULL
      || parse_url($endpoint, PHP_URL_QUERY) !== NULL
      || parse_url($endpoint, PHP_URL_FRAGMENT) !== NULL
      || ($options['token'] ?? '') !== ''
      || !in_array($options['mode'] ?? 'mock', ['mock', 'fixture'], TRUE)) {
      throw new \RuntimeException('The offline adapter endpoint is not configured safely.');
    }
    return $endpoint;
  }

  /**
   * Checks the two exact output branches without interpreting source text.
   */
  private function validResult(array $data): bool {
    if (array_keys($data) === ['error']) {
      return in_array($data['error'], ['missing_fields', 'ambiguous_input'], TRUE);
    }
    if (count($data) !== 2
      || !array_key_exists('customer_tier', $data)
      || !array_key_exists('purchase_amount', $data)
      || !is_string($data['customer_tier'])
      || !preg_match('/\S/u', $data['customer_tier'])
      || mb_strlen($data['customer_tier']) > 40
      || (!is_int($data['purchase_amount']) && !is_float($data['purchase_amount']))) {
      return FALSE;
    }
    return is_finite((float) $data['purchase_amount'])
      && $data['purchase_amount'] >= 0 && $data['purchase_amount'] <= 1_000_000;
  }

}
