<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_integration\Unit;

use Drupal\Tests\UnitTestCase;
use Drupal\pixiecore_integration\PixieCoreClient;
use GuzzleHttp\ClientInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\StreamInterface;

/** @coversDefaultClass \Drupal\pixiecore_integration\PixieCoreClient */
final class PixieCoreClientTest extends UnitTestCase {

  /** @covers ::execute */
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
        return $options['headers']['Authorization'] === 'Bearer secret'
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

}
