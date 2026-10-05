<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Kernel;

use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Site\Settings;
use Drupal\KernelTests\KernelTestBase;
use Drupal\pixiecore_integration\PixieCoreClientInterface;
use Drupal\pixiecore_specification\Blueprint\DiscountBlueprint;
use Drupal\pixiecore_specification\Execution\SpecificationExecutor;
use Drupal\pixiecore_specification\Storage\RevisionStore;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Tests persisted revisions, ownership, locks, and HTTP execution snapshots.
 */
#[Group('pixiecore_specification')]
#[RunTestsInSeparateProcesses]
final class SpecificationStorageTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'user', 'pixiecore_integration', 'pixiecore_specification'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installSchema('pixiecore_specification', ['pixiecore_spec_revision', 'pixiecore_spec_run']);
  }

  /**
   * Tests append-only persistence, independent owners, and stale saves.
   */
  public function testRevisionPersistenceAndOwnership(): void {
    $store = $this->container->get('pixiecore_specification.store');
    $builder = new DiscountBlueprint();
    $text = $builder->defaultBlueprint();
    $first = $store->save(1, 0, $text, $builder->build($text), DiscountBlueprint::DEFAULT_INPUTS);
    $secondText = str_replace('strictly greater than 1000', 'strictly greater than 2000', $text);
    $secondInputs = '{"customer_tier":"Gold","purchase_amount":2000}';
    $second = $store->save(1, 1, $secondText, $builder->build($secondText), $secondInputs);
    $reopened = new RevisionStore($this->container->get('database'), $this->container->get('datetime.time'));
    $this->assertSame(2, $reopened->latest(1)['revision']);
    $this->assertSame($secondText, $reopened->latest(1)['instruction']);
    $this->assertSame($secondInputs, $reopened->latest(1)['inputs_json']);
    $this->assertSame(DiscountBlueprint::DEFAULT_INPUTS, $first['inputs_json']);
    $this->assertNotSame($first['source_hash'], $second['source_hash']);
    $this->assertNull($reopened->latest(2));
    $this->expectException(\RuntimeException::class);
    $store->save(1, 1, $text, $builder->build($text), DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Tests complete Blueprint delivery and immutable execution records.
   */
  public function testExecuteUsesSavedRevision(): void {
    $builder = new DiscountBlueprint();
    $first = $builder->defaultBlueprint();
    $second = str_replace('strictly greater than 1000', 'strictly greater than 2000', $first);
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->exactly(2))->method('executeEnvelope')->willReturnCallback(
      static function (string $endpoint, string $token, string $yaml, array $inputs) use ($builder, $first, $second): array {
        self::assertSame('http://127.0.0.1:3000', $endpoint);
        self::assertSame(1200, $inputs['purchase_amount']);
        self::assertContains($yaml, [$builder->build($first), $builder->build($second)]);
        return [
          'data' => $yaml === $builder->build($first)
            ? ['discount' => 0.20, 'final_price' => 960]
            : ['discount' => 0, 'final_price' => 1200],
          'metadata' => ['provider' => 'fixture-mock', 'model' => 'offline-contract-fixtures'],
        ];
      },
    );
    $executor = $this->executor($client);
    $executor->save(1, 0, $first, DiscountBlueprint::DEFAULT_INPUTS);
    $one = $executor->execute(1, 1, str_replace("\n", "\r\n", $first), DiscountBlueprint::DEFAULT_INPUTS);
    $executor->save(1, 1, $second, DiscountBlueprint::DEFAULT_INPUTS);
    $two = $executor->execute(1, 2, $second, DiscountBlueprint::DEFAULT_INPUTS);
    $this->assertSame(960, $one['data']['final_price']);
    $this->assertSame(1200, $two['data']['final_price']);
    $this->assertSame(1, $one['revision']);
    $this->assertSame(2, $two['revision']);
    $this->assertSame('not_measured', $two['business_accuracy']);
    $this->assertNull($two['estimated_cost_usd']);
    $this->assertSame($two, $this->container->get('pixiecore_specification.store')->latestRun(1));
    $this->assertNull($this->container->get('pixiecore_specification.store')->latestRun(2));
  }

  /**
   * Tests dirty and stale execution rejection without a network request.
   */
  public function testRejectsUnsavedInstructionBeforeTransport(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $executor = $this->executor($client);
    $text = (new DiscountBlueprint())->defaultBlueprint();
    $executor->save(1, 0, $text, DiscountBlueprint::DEFAULT_INPUTS);
    $this->expectException(\RuntimeException::class);
    $executor->execute(1, 1, str_replace('strictly greater than 1000', 'strictly greater than 2000', $text), DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Tests paid execution is disabled regardless of an endpoint setting.
   */
  public function testRejectsRealModeBeforeTransport(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $executor = $this->executor($client, ['mode' => 'real']);
    $this->expectException(\RuntimeException::class);
    $executor->execute(1, 0, 'instruction', DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Tests transport exceptions do not leak secrets into persisted records.
   */
  public function testFailureIsRecordedWithoutSecretsAndReleasesLock(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->method('executeEnvelope')->willThrowException(new \RuntimeException('Bearer secret must not be stored'));
    $executor = $this->executor($client);
    $text = (new DiscountBlueprint())->defaultBlueprint();
    $executor->save(1, 0, $text, DiscountBlueprint::DEFAULT_INPUTS);
    $record = $executor->execute(1, 1, $text, DiscountBlueprint::DEFAULT_INPUTS);
    $this->assertSame('failed', $record['status']);
    $this->assertStringNotContainsString('secret', json_encode($record));
    $this->assertSame(2, $executor->save(1, 1, $text, DiscountBlueprint::DEFAULT_INPUTS)['revision']);
  }

  /**
   * Tests a second operation is refused while an owner lock is held.
   */
  public function testRejectsConcurrentOperation(): void {
    $lock = $this->container->get('lock');
    $lock->acquire('pixiecore_specification:1', 60);
    // Drupal locks are reentrant within one lock owner, so use a denied port.
    $denied = $this->createMock(LockBackendInterface::class);
    $denied->method('acquire')->willReturn(FALSE);
    $executor = new SpecificationExecutor(new DiscountBlueprint(), $this->container->get('pixiecore_specification.store'), $this->createMock(PixieCoreClientInterface::class), new Settings([]), $denied);
    $this->expectException(\RuntimeException::class);
    $executor->save(1, 0, (new DiscountBlueprint())->defaultBlueprint(), DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Rejects changed input even with unchanged instruction and current revision.
   */
  public function testRejectsUnsavedInputsBeforeTransport(): void {
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $executor = $this->executor($client);
    $text = (new DiscountBlueprint())->defaultBlueprint();
    $executor->save(1, 0, $text, DiscountBlueprint::DEFAULT_INPUTS);
    $this->expectException(\RuntimeException::class);
    $this->expectExceptionMessage('Save the current inputs');
    $executor->execute(1, 1, $text, '{"customer_tier":"Gold","purchase_amount":2000}');
  }

  /**
   * Migrates historical data without pretending its inputs were persisted.
   */
  public function testUpdatePreservesHistoricalRevisionAndRequiresSave(): void {
    $database = $this->container->get('database');
    $database->schema()->dropField('pixiecore_spec_revision', 'inputs_json');
    $text = (new DiscountBlueprint())->defaultBlueprint();
    $database->insert('pixiecore_spec_revision')->fields([
      'uid' => 1,
      'revision' => 1,
      'instruction' => $text,
      'blueprint' => (new DiscountBlueprint())->build($text),
      'source_hash' => str_repeat('a', 64),
      'created' => 1,
    ])->execute();
    $this->container->get('module_handler')->loadInclude('pixiecore_specification', 'install');
    pixiecore_specification_update_10001();
    pixiecore_specification_update_10001();
    $saved = $this->container->get('pixiecore_specification.store')->latest(1);
    $this->assertSame($text, $saved['instruction']);
    $this->assertNull($saved['inputs_json']);
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->never())->method('executeEnvelope');
    $this->expectException(\RuntimeException::class);
    $this->expectExceptionMessage('Save the current inputs');
    $this->executor($client)->execute(1, 1, $text, DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Delivers persisted non-default inputs unchanged to the runtime boundary.
   */
  public function testExecuteSavedNonDefaultInputs(): void {
    $text = (new DiscountBlueprint())->defaultBlueprint();
    $inputs = "{\n  \"customer_tier\":\"Gold\",\n  \"purchase_amount\":2000\n}";
    $client = $this->createMock(PixieCoreClientInterface::class);
    $client->expects($this->once())->method('executeEnvelope')
      ->with($this->anything(), $this->anything(), $this->anything(), [
        'customer_tier' => 'Gold',
        'purchase_amount' => 2000,
      ])
      ->willReturn(['data' => ['discount' => 0.20, 'final_price' => 1600], 'metadata' => ['provider' => 'fixture-mock']]);
    $executor = $this->executor($client);
    $executor->save(1, 0, $text, $inputs);
    $result = $executor->execute(1, 1, $text, str_replace("\n", "\r\n", $inputs));
    $this->assertSame('unverified', $result['status']);
    $this->assertSame(2000, $result['inputs']['purchase_amount']);
    $this->assertSame(1600, $result['data']['final_price']);
  }

  /**
   * Composes an executor with an offline HTTP port and trusted settings.
   */
  private function executor(PixieCoreClientInterface $client, array $options = []): SpecificationExecutor {
    return new SpecificationExecutor(
      new DiscountBlueprint(),
      $this->container->get('pixiecore_specification.store'),
      $client,
      new Settings([
        'pixiecore_specification' => $options + [
          'mode' => 'mock',
          'endpoint' => 'http://127.0.0.1:3000',
          'token' => '',
        ],
      ]),
      $this->container->get('lock'),
    );
  }

}
