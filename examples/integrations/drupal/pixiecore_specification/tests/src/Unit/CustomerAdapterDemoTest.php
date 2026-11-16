<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Unit;

use Drupal\Core\Site\Settings;
use Drupal\Tests\UnitTestCase;
use Drupal\pixiecore_integration\PixieCoreClientInterface;
use Drupal\pixiecore_specification\Adapter\CustomerAdapterDemo;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests opaque input delivery, expectations, and offline boundaries.
 */
#[Group('pixiecore_specification')]
final class CustomerAdapterDemoTest extends UnitTestCase {

  /**
   * Tests reading and selecting fixtures never sends an HTTP request.
   */
  public function testViewingDoesNotExecute(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $demo = new CustomerAdapterDemo($client, new Settings([]));
    $this->assertSame(['json', 'csv', 'text', 'missing', 'ambiguous'], array_keys($demo->cases()));
    $this->assertStringContainsString('{{ source_text }}', $demo->blueprint());
    $this->assertSame('customer_tier,purchase_amount' . "\n" . 'Gold,1200', $demo->cases()['csv']['inputs']['source_text']);
  }

  /**
   * Tests every case uses one unchanged Blueprint and its original source text.
   */
  #[DataProvider('acceptedCases')]
  public function testExecutesBundledCase(string $id, array $expected, string $status): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $demo = new CustomerAdapterDemo($client, new Settings([
      'pixiecore_adapter' => ['endpoint' => 'http://127.0.0.1:3088'],
      // Existing live settings must not leak into the adapter's request.
      'pixiecore_specification' => ['mode' => 'real', 'token' => 'not-used'],
    ]));
    $client->expects($this->once())->method('executeEnvelope')
      ->with('http://127.0.0.1:3088', '', $demo->blueprint(), $demo->cases()[$id]['inputs'])
      ->willReturn([
        'metadata' => ['provider' => 'adapter-fixture', 'model' => 'offline-contract-fixtures'],
        'data' => $expected,
      ]);
    $record = $demo->execute($id);
    $this->assertSame($status, $record['status']);
    $this->assertSame($expected, $record['data']);
    $this->assertSame('passed', $record['schema_validation']);
    $this->assertSame('passed', $record['expected_match']);
    $this->assertSame('not_measured', $record['model_accuracy']);
    $this->assertSame('fixture', $record['mode']);
    $this->assertSame(1, $record['http_requests']);
    $this->assertSame(hash('sha256', $demo->blueprint()), $record['blueprint_sha256']);
  }

  /**
   * Provides independently fixed success and review expectations.
   */
  public static function acceptedCases(): array {
    return [
      ['json', ['customer_tier' => 'Gold', 'purchase_amount' => 1200], 'passed'],
      ['csv', ['customer_tier' => 'Gold', 'purchase_amount' => 1200], 'passed'],
      ['text', ['customer_tier' => 'Gold', 'purchase_amount' => 1200], 'passed'],
      ['missing', ['error' => 'missing_fields'], 'review_required'],
      ['ambiguous', ['error' => 'ambiguous_input'], 'review_required'],
    ];
  }

  /**
   * Tests an unbundled case is rejected before transport.
   */
  public function testUnknownCaseDoesNotExecute(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $demo = new CustomerAdapterDemo($client, new Settings([]));
    $this->expectException(\InvalidArgumentException::class);
    $demo->execute('untrusted');
  }

  /**
   * Tests unsafe settings cannot send credentials or reach an external host.
   */
  #[DataProvider('unsafeSettings')]
  public function testRejectsUnsafeSettings(mixed $options): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $demo = new CustomerAdapterDemo($client, new Settings(['pixiecore_adapter' => $options]));
    $this->expectException(\RuntimeException::class);
    $demo->execute('json');
  }

  /**
   * Provides unsafe locations and attempts to activate a provider.
   */
  public static function unsafeSettings(): array {
    return [
      [NULL],
      [[]],
      [['endpoint' => 'https://api.example.test']],
      [['endpoint' => 'http://remote.example.test']],
      [['endpoint' => 'http://127.0.0.1:3088/other']],
      [['endpoint' => 'http://username:password@localhost:3088']],
      [['endpoint' => 'http://127.0.0.1:3088?key=value']],
      [['endpoint' => 'http://127.0.0.1:3088#fragment']],
      [['endpoint' => 'http://127.0.0.1:3088', 'token' => 'not-allowed']],
      [['endpoint' => 'http://127.0.0.1:3088', 'mode' => 'real']],
    ];
  }

  /**
   * Tests schema failures and valid-but-wrong answers never become success.
   */
  #[DataProvider('invalidResponses')]
  public function testRejectsInvalidResult(array $response, string $schema, string $match): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->once())->method('executeEnvelope')->willReturn($response);
    $demo = new CustomerAdapterDemo($client, new Settings([
      'pixiecore_adapter' => ['endpoint' => 'http://localhost:3088'],
    ]));
    $record = $demo->execute('json');
    $this->assertSame('failed', $record['status']);
    $this->assertSame($schema, $record['schema_validation']);
    $this->assertSame($match, $record['expected_match']);
    $this->assertArrayNotHasKey('data', $record);
    $this->assertArrayNotHasKey('provider', $record);
  }

  /**
   * Provides malformed values, unexpected providers, and semantic mismatches.
   */
  public static function invalidResponses(): array {
    $metadata = ['provider' => 'adapter-fixture', 'model' => 'offline-contract-fixtures'];
    $success = ['customer_tier' => 'Gold', 'purchase_amount' => 1200];
    $invalid = [
      [],
      ['customer_tier' => 'Gold', 'purchase_amount' => '1200'],
      ['customer_tier' => 'Gold', 'purchase_amount' => TRUE],
      ['customer_tier' => 'Gold', 'purchase_amount' => INF],
      ['customer_tier' => 'Gold', 'purchase_amount' => -1],
      ['customer_tier' => 'Gold', 'purchase_amount' => 1_000_001],
      ['customer_tier' => ' ', 'purchase_amount' => 1200],
      ['customer_tier' => 'Gold', 'purchase_amount' => 1200, 'extra' => TRUE],
      ['error' => 'unknown'],
      ['error' => 'missing_fields', 'customer_tier' => 'Gold'],
    ];
    $cases = array_map(static fn(array $data): array => [
      ['metadata' => $metadata, 'data' => $data],
      'failed',
      'not_checked',
    ], $invalid);
    $cases[] = [
      ['metadata' => $metadata, 'data' => ['customer_tier' => 'Silver', 'purchase_amount' => 1200]],
      'passed',
      'failed',
    ];
    $cases[] = [
      ['metadata' => $metadata, 'data' => ['error' => 'missing_fields']],
      'passed',
      'failed',
    ];
    $cases[] = [
      ['metadata' => ['provider' => 'openai', 'model' => 'offline-contract-fixtures'], 'data' => $success],
      'not_checked',
      'not_checked',
    ];
    $cases[] = [
      ['metadata' => ['provider' => 'adapter-fixture', 'model' => 'unexpected'], 'data' => $success],
      'not_checked',
      'not_checked',
    ];
    return $cases;
  }

  /**
   * Tests transport exception details do not enter the displayed record.
   */
  public function testSanitizesTransportFailure(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->method('executeEnvelope')->willThrowException(new \RuntimeException('private backend detail'));
    $demo = new CustomerAdapterDemo($client, new Settings([
      'pixiecore_adapter' => ['endpoint' => 'http://127.0.0.1:3088'],
    ]));
    $record = $demo->execute('json');
    $this->assertSame('failed', $record['status']);
    $this->assertStringNotContainsString('private backend detail', json_encode($record, JSON_THROW_ON_ERROR));
  }

}
