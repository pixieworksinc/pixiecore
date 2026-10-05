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
    return in_array($options['mode'] ?? '', ['mock', 'real'], TRUE) ? $options['mode'] : 'disabled';
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
    if (!in_array($scheme, ['http', 'https'], TRUE) || parse_url($endpoint, PHP_URL_USER) !== NULL || parse_url($endpoint, PHP_URL_QUERY) !== NULL || parse_url($endpoint, PHP_URL_FRAGMENT) !== NULL) {
      throw new \RuntimeException('The trusted endpoint must be an HTTP URL without credentials, query, or fragment.');
    }
    if ($scheme === 'http' && !in_array($host, ['127.0.0.1', 'localhost', '[::1]'], TRUE)) {
      $privateEndpoint = $options['private_http_endpoint'] ?? NULL;
      // parse_url() retains IPv6 brackets, but FILTER_VALIDATE_IP does not.
      $ipHost = is_string($host) && str_starts_with($host, '[') && str_ends_with($host, ']')
        ? substr($host, 1, -1) : $host;
      $ipLiteral = is_string($ipHost) && filter_var($ipHost, FILTER_VALIDATE_IP) !== FALSE;
      $ipBytes = $ipLiteral ? inet_pton($ipHost) : FALSE;
      // An IPv4-mapped address appears reserved to the IPv6 filter.
      // Reject it over HTTP even when its embedded IPv4 is public.
      $mappedIpv4 = is_string($ipBytes) && strlen($ipBytes) === 16
        && str_starts_with($ipBytes, str_repeat("\0", 10) . "\xff\xff");
      // HTTP clients may interpret integer, octal, and hexadecimal hosts as
      // IPv4 even though FILTER_VALIDATE_IP rejects those spellings.
      $numericHost = !$ipLiteral && is_string($ipHost)
        && preg_match('/^(?:0[xX][0-9A-Fa-f]+|[0-9]+)(?:\.(?:0[xX][0-9A-Fa-f]+|[0-9]+))*\.?$/', $ipHost) === 1;
      $requiresHttps = $numericHost || $mappedIpv4 || ($ipLiteral
        && filter_var($ipHost, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== FALSE);
      $trustedPrivateEndpoint = $mode === 'real' && !$requiresHttps
        && is_string($privateEndpoint) && $privateEndpoint !== ''
        && hash_equals($privateEndpoint, $endpoint);
      if (!$trustedPrivateEndpoint) {
        throw new \RuntimeException('Non-loopback runtime endpoints require HTTPS.');
      }
    }
    if ($mode === 'real' && strlen($token) < 32) {
      throw new \RuntimeException('The trusted runtime token is unavailable.');
    }
    $expectedModel = $options['expected_model'] ?? NULL;
    $maxCost = $options['max_cost_micro_usd'] ?? NULL;
    if ($mode === 'real' && (!is_string($expectedModel) || trim($expectedModel) === ''
      || !is_int($maxCost) || $maxCost < 0)) {
      throw new \RuntimeException('The trusted runtime model and budget are not configured.');
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
          if (($metadata['model'] ?? '') !== $expectedModel
            || ($metadata['provider_calls'] ?? NULL) !== 1
            || !is_int($metadata['input_tokens'] ?? NULL)
            || !is_int($metadata['output_tokens'] ?? NULL)
            || $metadata['input_tokens'] < 0
            || $metadata['output_tokens'] < 0
            || !is_numeric($metadata['estimated_cost_usd'] ?? NULL)
            || !is_finite((float) $metadata['estimated_cost_usd'])
            || (float) $metadata['estimated_cost_usd'] < 0
            || (float) $metadata['estimated_cost_usd'] > $maxCost / 1000000) {
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
