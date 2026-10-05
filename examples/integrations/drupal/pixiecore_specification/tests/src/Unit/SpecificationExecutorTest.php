<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Unit;

use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Site\Settings;
use Drupal\Tests\UnitTestCase;
use Drupal\pixiecore_integration\PixieCoreClientInterface;
use Drupal\pixiecore_specification\Blueprint\DiscountBlueprint;
use Drupal\pixiecore_specification\Execution\SpecificationExecutor;
use Drupal\pixiecore_specification\Storage\RevisionStoreInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests pre-request rejection and sanitization without a database or network.
 */
#[Group('pixiecore_specification')]
final class SpecificationExecutorTest extends UnitTestCase {

  /**
   * Tests invalid transport settings cannot reach the HTTP port.
   */
  #[DataProvider('invalidEndpoints')]
  public function testRejectsUnsafeEndpoint(string $endpoint): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $store = $this->createMock(RevisionStoreInterface::class);
    $store->expects($this->never())->method('latest');
    $executor = new SpecificationExecutor(new DiscountBlueprint(), $store, $client, new Settings([
      'pixiecore_specification' => ['mode' => 'mock', 'endpoint' => $endpoint],
    ]), $this->createMock(LockBackendInterface::class));
    $this->expectException(\RuntimeException::class);
    $executor->execute(1, 1, 'instruction', DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Provides unsafe or malformed trusted transport configuration.
   */
  public static function invalidEndpoints(): array {
    return [
      [''], ['not a URL'], ['file:///etc/passwd'],
      ['http://remote.example.test'], ['https://remote.example.test'],
      ['http://user:password@localhost'],
      ['http://localhost?token=not-a-real-token'], ['http://localhost#fragment'],
      ['http://8.8.8.8:3087'], ['http://134744072:3087'],
      ['http://0x08080808:3087'], ['http://010.010.010.010:3087'],
      ['http://[::ffff:8.8.8.8]:3087'],
    ];
  }

  /**
   * Tests a credential cannot turn the offline fixture into a paid call.
   */
  public function testRejectsFixtureCredentials(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $store = $this->createMock(RevisionStoreInterface::class);
    $store->expects($this->never())->method('latest');
    $executor = new SpecificationExecutor(new DiscountBlueprint(), $store, $client, new Settings([
      'pixiecore_specification' => [
        'mode' => 'mock',
        'endpoint' => 'http://127.0.0.1:3087',
        'token' => str_repeat('x', 32),
      ],
    ]), $this->createMock(LockBackendInterface::class));
    $this->expectException(\RuntimeException::class);
    $executor->execute(1, 1, 'instruction', DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Tests stale revisions are rejected even when instruction text matches.
   */
  public function testRejectsStaleRevision(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $store = $this->createMock(RevisionStoreInterface::class);
    $store->method('latest')->willReturn(['revision' => 2, 'instruction' => 'instruction']);
    $lock = $this->createMock(LockBackendInterface::class);
    $lock->method('acquire')->willReturn(TRUE);
    $lock->expects($this->once())->method('release');
    $executor = new SpecificationExecutor(new DiscountBlueprint(), $store, $client, new Settings([
      'pixiecore_specification' => ['mode' => 'mock', 'endpoint' => 'http://localhost'],
    ]), $lock);
    $this->expectException(\RuntimeException::class);
    $executor->execute(1, 1, 'instruction', DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Tests both invalid outputs and wrong provider identifiers remain failures.
   */
  #[DataProvider('invalidResponses')]
  public function testRecordsInvalidResponseAsFailure(array $response): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->method('executeEnvelope')->willReturn($response);
    $store = $this->createMock(RevisionStoreInterface::class);
    $store->method('latest')->willReturn([
      'revision' => 1,
      'instruction' => 'instruction',
      'blueprint' => 'saved yaml',
      'inputs_json' => DiscountBlueprint::DEFAULT_INPUTS,
      'source_hash' => str_repeat('a', 64),
    ]);
    $store->expects($this->once())->method('record')->with(1, $this->anything(), $this->callback(static fn(array $record): bool => $record['status'] === 'failed' && !isset($record['data'])));
    $lock = $this->createMock(LockBackendInterface::class);
    $lock->method('acquire')->willReturn(TRUE);
    $lock->expects($this->once())->method('release');
    $executor = new SpecificationExecutor(new DiscountBlueprint(), $store, $client, new Settings([
      'pixiecore_specification' => ['mode' => 'mock', 'endpoint' => 'http://localhost'],
    ]), $lock);
    $result = $executor->execute(1, 1, 'instruction', DiscountBlueprint::DEFAULT_INPUTS);
    $this->assertSame('failed', $result['status']);
    $this->assertNull($result['input_tokens']);
    $this->assertArrayNotHasKey('data', $result);
  }

  /**
   * Provides a non-mock backend, arithmetic mismatch, and malformed data.
   */
  public static function invalidResponses(): array {
    return [
      [['metadata' => ['provider' => 'not-mock'], 'data' => ['discount' => 0.15, 'final_price' => 1020]]],
      [['metadata' => ['provider' => 'fixture-mock'], 'data' => ['discount' => 0.15, 'final_price' => 960]]],
      [['metadata' => ['provider' => 'fixture-mock'], 'data' => []]],
    ];
  }

}
