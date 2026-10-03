<?php

declare(strict_types=1);

namespace Drupal\pixiecore_integration;

use Drupal\Component\Serialization\Json;
use GuzzleHttp\ClientInterface;

/** Calls the narrow PixieCore execution boundary without submitting identity. */
final class PixieCoreClient {

  public function __construct(
    private readonly ClientInterface $httpClient,
  ) {}

  /**
   * Executes one inline Blueprint through a separately operated PixieCore API.
   *
   * @param array<string, mixed> $inputs
   *   Blueprint business inputs. Never add caller identity or server secrets.
   *
   * @return array<string, mixed>
   *   The validated Blueprint result.
   */
  public function execute(
    string $baseUrl,
    string $bearerToken,
    string $blueprintYaml,
    array $inputs,
  ): array {
    if (trim($baseUrl) === '' || trim($blueprintYaml) === '') {
      throw new \InvalidArgumentException('PixieCore URL and Blueprint are required.');
    }

    $headers = ['Accept' => 'application/json'];
    if ($bearerToken !== '') {
      $headers['Authorization'] = 'Bearer ' . $bearerToken;
    }
    $response = $this->httpClient->request('POST', rtrim($baseUrl, '/') . '/execute', [
      'headers' => $headers,
      'json' => [
        'blueprint' => $blueprintYaml,
        'inputs' => $inputs,
      ],
      'timeout' => 30,
    ]);
    $payload = Json::decode((string) $response->getBody());

    if (!is_array($payload) || ($payload['status'] ?? NULL) !== 'success') {
      throw new \UnexpectedValueException('PixieCore returned an invalid response envelope.');
    }
    if (!isset($payload['data']) || !is_array($payload['data'])) {
      throw new \UnexpectedValueException('PixieCore response data must be an object.');
    }
    return $payload['data'];
  }

}
