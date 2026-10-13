<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_integration\Unit;

use Drupal\Tests\UnitTestCase;
use Drupal\pixiecore_integration\PixieCoreClient;
use GuzzleHttp\ClientInterface;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\StreamInterface;

/**
 * Tests the bounded HTTP request and response contract.
 */
#[CoversClass(PixieCoreClient::class)]
final class PixieCoreClientTest extends UnitTestCase {

  /**
   * Tests that only Blueprint and business inputs cross the HTTP boundary.
   */
  public function testExecuteSendsOnlyBlueprintAndBusinessInputs(): void {
    $stream = $this->createMock(StreamInterface::class);
    $stream->method('__toString')->willReturn('{"status":"success","data":{"result":"ok"}}');
    $response = $this->createMock(ResponseInterface::class);
    $response->method('getBody')->willReturn($stream);
    $http = $this->createMock(ClientInterface::class);
    $http->expects($this->once())->method('request')->with(
      'POST',
      'https://pixiecore.example.test/execute',
      $this->callback(static function (array $options): bool {
        return $options['allow_redirects'] === FALSE
          && $options['connect_timeout'] === 5
          && $options['headers']['Authorization'] === 'Bearer secret'
          && $options['json'] === [
            'blueprint' => 'name: fixture',
            'inputs' => ['input' => 'value'],
          ];
      }),
    )->willReturn($response);

    $client = new PixieCoreClient($http);
    $this->assertSame(
      ['result' => 'ok'],
      $client->execute(
        'https://pixiecore.example.test',
        'secret',
        'name: fixture',
        ['input' => 'value'],
      ),
    );
  }

  /**
   * Tests metadata is preserved without adding an empty bearer credential.
   */
  public function testPreservesEnvelopeMetadata(): void {
    $payload = ['status' => 'success', 'data' => ['result' => 'ok'], 'metadata' => ['provider' => 'fixture-mock']];
    $stream = $this->createMock(StreamInterface::class);
    $stream->method('__toString')->willReturn(json_encode($payload, JSON_THROW_ON_ERROR));
    $response = $this->createMock(ResponseInterface::class);
    $response->method('getBody')->willReturn($stream);
    $http = $this->createMock(ClientInterface::class);
    $http->expects($this->once())->method('request')->with('POST', 'http://localhost/execute', $this->callback(static fn(array $options): bool => !isset($options['headers']['Authorization']) && $options['timeout'] === 30))->willReturn($response);
    $this->assertSame($payload, (new PixieCoreClient($http))->executeEnvelope('http://localhost', '', 'fixture', []));
  }

  /**
   * Tests malformed response envelopes cannot be mistaken for successful data.
   */
  #[DataProvider('invalidPayloads')]
  public function testRejectsInvalidEnvelope(string $payload): void {
    $stream = $this->createMock(StreamInterface::class);
    $stream->method('__toString')->willReturn($payload);
    $response = $this->createMock(ResponseInterface::class);
    $response->method('getBody')->willReturn($stream);
    $http = $this->createMock(ClientInterface::class);
    $http->method('request')->willReturn($response);
    $this->expectException(\UnexpectedValueException::class);
    (new PixieCoreClient($http))->executeEnvelope('http://localhost', '', 'fixture', []);
  }

  /**
   * Provides invalid status, missing data, scalar data, and scalar envelopes.
   */
  public static function invalidPayloads(): array {
    return [
      ['{"status":"error","data":{}}'],
      ['{"status":"success"}'],
      ['{"status":"success","data":"wrong"}'],
      ['null'],
    ];
  }

}
