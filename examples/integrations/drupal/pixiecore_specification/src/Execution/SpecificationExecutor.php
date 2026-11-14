<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Execution;

use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Site\Settings;
use Drupal\pixiecore_integration\PixieCoreClientInterface;
use Drupal\pixiecore_specification\Blueprint\DiscountBlueprintInterface;
use Drupal\pixiecore_specification\Storage\RevisionStoreInterface;

/**
 * Sends saved specifications across one bounded runtime HTTP boundary.
 */
final class SpecificationExecutor implements SpecificationExecutorInterface {

  /**
   * Constructs the executor without reading editable provider configuration.
   */
  public function __construct(
    private readonly DiscountBlueprintInterface $blueprint,
    private readonly RevisionStoreInterface $store,
    private readonly PixieCoreClientInterface $client,
    private readonly Settings $settings,
    private readonly LockBackendInterface $lock,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function mode(): string {
    $options = $this->settings->get('pixiecore_specification', []);
    if (!is_array($options)) {
      return 'disabled';
    }
    if (($options['mode'] ?? '') === 'mock') {
      return 'mock';
    }
    return ($options['mode'] ?? '') === 'real' && ($options['allow_live'] ?? FALSE) === TRUE ? 'real' : 'disabled';
  }

  /**
   * {@inheritdoc}
   */
  public function save(int $uid, int $revision, string $instruction, string $inputsJson): array {
    $yaml = $this->blueprint->build($instruction);
    $this->blueprint->inputs($inputsJson);
    $key = $this->acquire($uid);
    try {
      return $this->store->save($uid, $revision, $instruction, $yaml, $inputsJson);
    }
    finally {
      $this->lock->release($key);
    }
  }

  /**
   * {@inheritdoc}
   */
  public function execute(int $uid, int $revision, string $instruction, string $inputsJson): array {
    $inputs = $this->blueprint->inputs($inputsJson);
    $options = $this->settings->get('pixiecore_specification', []);
    $mode = $this->mode();
    if ($mode === 'disabled' || !is_array($options)) {
      throw new \RuntimeException('Execution is disabled.');
    }
    $endpoint = $options['endpoint'] ?? '';
    $token = $options['token'] ?? '';
    if (!is_string($endpoint) || !is_string($token) || !filter_var($endpoint, FILTER_VALIDATE_URL)) {
      throw new \RuntimeException('The trusted runtime endpoint is not configured.');
    }
    $scheme = parse_url($endpoint, PHP_URL_SCHEME);
    $host = parse_url($endpoint, PHP_URL_HOST);
    if ($scheme !== 'http' || !in_array($host, ['127.0.0.1', 'localhost', '[::1]'], TRUE)
      || ($mode === 'mock' ? $token !== '' : strlen($token) < 32)
      || parse_url($endpoint, PHP_URL_USER) !== NULL
      || parse_url($endpoint, PHP_URL_QUERY) !== NULL || parse_url($endpoint, PHP_URL_FRAGMENT) !== NULL) {
      throw new \RuntimeException('The runtime must use loopback HTTP and credentials appropriate to its mode.');
    }
    $key = $this->acquire($uid);
    try {
      $saved = $this->store->latest($uid);
      // HTML forms serialize textarea newlines as CRLF, including after Reset.
      // Compare display values only; deliver the saved Blueprint verbatim.
      if (!$saved || $saved['revision'] !== $revision || str_replace("\r\n", "\n", $saved['instruction']) !== str_replace("\r\n", "\n", $instruction)) {
        throw new \RuntimeException('Save the current Blueprint before Execute. Reload if the revision changed.');
      }
      if (!is_string($saved['inputs_json'] ?? NULL)
        || str_replace("\r\n", "\n", $saved['inputs_json']) !== str_replace("\r\n", "\n", $inputsJson)) {
        throw new \RuntimeException('Save the current inputs before Execute. Historical revisions did not store inputs.');
      }
      $inputs = $this->blueprint->inputs($saved['inputs_json']);
      $record = [
        'revision' => $revision,
        'source_hash' => $saved['source_hash'],
        'inputs' => $inputs,
        'mode' => $mode,
        'status' => 'failed',
        'http_requests' => 1,
        'provider_calls' => NULL,
        'input_tokens' => NULL,
        'output_tokens' => NULL,
        'estimated_cost_usd' => NULL,
      ];
      $started = microtime(TRUE);
      try {
        $response = $this->client->executeEnvelope($endpoint, $token, $saved['blueprint'], $inputs);
        $provider = $response['metadata']['provider'] ?? '';
        if ($provider !== ($mode === 'mock' ? 'fixture-mock' : 'openai')) {
          throw new \UnexpectedValueException('The configured backend did not identify the expected provider.');
        }
        if ($mode === 'real') {
          $metadata = $response['metadata'];
          if (($metadata['model'] ?? '') !== 'gpt-6-luna'
            || ($metadata['provider_calls'] ?? NULL) !== 1
            || !is_int($metadata['input_tokens'] ?? NULL)
            || !is_int($metadata['output_tokens'] ?? NULL)
            || $metadata['input_tokens'] < 1
            || $metadata['input_tokens'] > 1050000
            || $metadata['output_tokens'] < 0
            || $metadata['output_tokens'] > 512
            || !is_string($metadata['startup_id'] ?? NULL)
            || trim($metadata['startup_id']) === ''
            || !is_numeric($metadata['estimated_cost_usd'] ?? NULL)
            || !is_finite((float) $metadata['estimated_cost_usd'])
            || (float) $metadata['estimated_cost_usd'] < 0
            || (float) $metadata['estimated_cost_usd'] > 1) {
            throw new \UnexpectedValueException('Real-provider usage evidence is incomplete.');
          }
          $record['provider_calls'] = 1;
          $record['input_tokens'] = $metadata['input_tokens'];
          $record['output_tokens'] = $metadata['output_tokens'];
          $record['estimated_cost_usd'] = (float) $metadata['estimated_cost_usd'];
          $record['startup_id'] = $metadata['startup_id'] ?? NULL;
        }
        $this->blueprint->validateResult($response['data'], $inputs);
        $record['status'] = 'unverified';
        $record['data'] = $response['data'];
        $record['schema_and_arithmetic'] = 'passed';
        $record['business_accuracy'] = 'not_measured';
        $record['provider'] = $provider;
        $record['model'] = $response['metadata']['model'] ?? NULL;
      }
      catch (\Throwable) {
        // Keep exception messages, credentials, and raw bodies out of storage.
        $record['failure'] = 'Runtime request or response validation failed.';
      }
      $record['duration_ms'] = round((microtime(TRUE) - $started) * 1000, 3);
      $this->store->record($uid, $saved, $record);
      return $record;
    }
    finally {
      $this->lock->release($key);
    }
  }

  /**
   * Acquires one owner lock across Save or a bounded synchronous Execute.
   */
  private function acquire(int $uid): string {
    if ($uid <= 0) {
      throw new \InvalidArgumentException('An authenticated owner is required.');
    }
    $key = 'pixiecore_specification:' . $uid;
    if (!$this->lock->acquire($key, 60)) {
      throw new \RuntimeException('Another Save or Execute is in progress. Try again after it finishes.');
    }
    return $key;
  }

}
