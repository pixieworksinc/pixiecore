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
      ['http://remote.example.test'], ['http://user:password@localhost'],
      ['http://localhost?token=not-a-real-token'], ['http://localhost#fragment'],
    ];
  }

  /**
   * Tests private HTTP is rejected unless the real deployment names it exactly.
   */
  #[DataProvider('unapprovedPrivateEndpoints')]
  public function testRejectsUnapprovedPrivateEndpoint(string $endpoint, string $approved): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $store = $this->createMock(RevisionStoreInterface::class);
    $store->expects($this->never())->method('latest');
    $executor = new SpecificationExecutor(new DiscountBlueprint(), $store, $client, new Settings([
      'pixiecore_specification' => [
        'mode' => 'real',
        'endpoint' => $endpoint,
        'private_http_endpoint' => $approved,
        'token' => str_repeat('x', 32),
      ],
    ]), $this->createMock(LockBackendInterface::class));
    $this->expectException(\RuntimeException::class);
    $executor->execute(1, 1, 'instruction', DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Provides mismatched and public-address endpoints that must stay blocked.
   */
  public static function unapprovedPrivateEndpoints(): array {
    return [
      'different private address' => ['http://172.17.0.1:3087', 'http://172.17.0.2:3087'],
      'public address' => ['http://8.8.8.8:3087', 'http://8.8.8.8:3087'],
      'public integer address' => ['http://134744072:3087', 'http://134744072:3087'],
      'public hexadecimal address' => ['http://0x08080808:3087', 'http://0x08080808:3087'],
      'public octal address' => ['http://010.010.010.010:3087', 'http://010.010.010.010:3087'],
      'public IPv6 address' => ['http://[2606:4700:4700::1111]:3087', 'http://[2606:4700:4700::1111]:3087'],
      'IPv4-mapped public address' => ['http://[::ffff:8.8.8.8]:3087', 'http://[::ffff:8.8.8.8]:3087'],
      'IPv4-mapped public hex address' => ['http://[::ffff:808:808]:3087', 'http://[::ffff:808:808]:3087'],
      'unapproved hostname' => ['http://runtime:3087', ''],
      'different hostname' => ['http://runtime:3087', 'http://other-runtime:3087'],
    ];
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

  /**
   * Tests the real-provider mode records usage only for a trusted response.
   */
  #[DataProvider('realEndpoints')]
  public function testRecordsRealProviderUsage(array $endpointSettings): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->method('executeEnvelope')->willReturn([
      'metadata' => [
        'provider' => 'openai',
        'model' => 'gpt-4o-mini-2024-07-18',
        'provider_calls' => 1,
        'input_tokens' => 100,
        'output_tokens' => 20,
        'estimated_cost_usd' => 0.000027,
        'startup_id' => 'test-startup',
      ],
      'data' => ['discount' => 0.20, 'final_price' => 960],
    ]);
    $store = $this->createMock(RevisionStoreInterface::class);
    $store->method('latest')->willReturn([
      'revision' => 1,
      'instruction' => 'instruction',
      'blueprint' => 'saved yaml',
      'inputs_json' => DiscountBlueprint::DEFAULT_INPUTS,
      'source_hash' => str_repeat('a', 64),
    ]);
    $store->expects($this->once())->method('record')->with(
      1,
      $this->anything(),
      $this->callback(static fn(array $record): bool =>
        $record['mode'] === 'real' && $record['provider_calls'] === 1
        && $record['input_tokens'] === 100
        && $record['estimated_cost_usd'] === 0.000027),
    );
    $lock = $this->createMock(LockBackendInterface::class);
    $lock->method('acquire')->willReturn(TRUE);
    $settings = new Settings([
      'pixiecore_specification' => $endpointSettings + [
        'mode' => 'real',
        'token' => str_repeat('x', 32),
        'expected_model' => 'gpt-4o-mini-2024-07-18',
        'max_cost_micro_usd' => 100,
      ],
    ]);
    $executor = new SpecificationExecutor(new DiscountBlueprint(), $store, $client, $settings, $lock);
    $record = $executor->execute(1, 1, 'instruction', DiscountBlueprint::DEFAULT_INPUTS);
    $this->assertSame('unverified', $record['status']);
    $this->assertSame(20, $record['output_tokens']);
  }

  /**
   * Provides the isolated Docker DNS and exact private host-gateway routes.
   */
  public static function realEndpoints(): array {
    return [
      'docker network' => [
        [
          'endpoint' => 'http://runtime:3087',
          'private_http_endpoint' => 'http://runtime:3087',
        ],
      ],
      'private host gateway' => [
        [
          'endpoint' => 'http://172.17.0.1:3087',
          'private_http_endpoint' => 'http://172.17.0.1:3087',
        ],
      ],
      'private IPv6 address' => [
        [
          'endpoint' => 'http://[fd00::1]:3087',
          'private_http_endpoint' => 'http://[fd00::1]:3087',
        ],
      ],
    ];
  }

}
