<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Unit;

use Drupal\Component\DependencyInjection\ReverseContainer;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Form\FormState;
use Drupal\Tests\UnitTestCase;
use Drupal\pixiecore_specification\Adapter\CustomerAdapterDemoInterface;
use Drupal\pixiecore_specification\Form\CustomerAdapterForm;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests form selection and result ownership without HTTP or persistent storage.
 */
#[Group('pixiecore_specification')]
final class CustomerAdapterFormTest extends UnitTestCase {

  /**
   * Tests cached forms recover their injected adapter before Execute.
   */
  public function testExecuteAfterFormCacheSerialization(): void {
    $original = $this->createMock(CustomerAdapterDemoInterface::class);
    $original->expects($this->never())->method('execute');
    $translation = $this->getStringTranslationStub();
    $container = new ContainerBuilder();
    $container->set('pixiecore_specification.adapter', $original);
    $container->set('string_translation', $translation);
    $container->set(ReverseContainer::class, new ReverseContainer($container));
    \Drupal::setContainer($container);
    $form = new CustomerAdapterForm($original);
    $form->setStringTranslation($translation);
    $serialized = serialize($form);
    $this->assertStringContainsString('pixiecore_specification.adapter', $serialized);

    // A fresh request must rehydrate services, rather than serialize a client.
    $adapter = $this->createMock(CustomerAdapterDemoInterface::class);
    $adapter->method('cases')->willReturn($this->cases());
    $adapter->method('blueprint')->willReturn('immutable Blueprint');
    $record = [
      'case_id' => 'json',
      'blueprint_sha256' => hash('sha256', 'immutable Blueprint'),
      'status' => 'passed',
      'data' => ['customer_tier' => 'Gold', 'purchase_amount' => 1200],
    ];
    $adapter->expects($this->once())->method('execute')->with('json')->willReturn($record);
    $container->set('pixiecore_specification.adapter', $adapter);
    $restored = unserialize($serialized);
    $this->assertInstanceOf(CustomerAdapterForm::class, $restored);
    $state = new FormState();
    $state->setValue('case_id', 'json');
    $state->setTriggeringElement(['#adapter_operation' => 'execute']);
    $built = [];
    $restored->submitForm($built, $state);
    $rebuilt = $restored->buildForm([], $state);
    $this->assertSame($record, $state->get('adapter_result'));
    $this->assertStringContainsString('"customer_tier": "Gold"', $rebuilt['result']['#default_value']);
  }

  /**
   * Returns the five synthetic cases for pure form-state tests.
   */
  private function cases(): array {
    $source = __DIR__ . '/../../../blueprints/customer-adapter/cases.json';
    $cases = json_decode(file_get_contents($source), TRUE, 32, JSON_THROW_ON_ERROR);
    return array_column($cases, NULL, 'id');
  }

  /**
   * Tests initial display and viewing a new case never execute the adapter.
   */
  public function testViewingClearsEarlierCaseResult(): void {
    $adapter = $this->createMock(CustomerAdapterDemoInterface::class);
    $adapter->method('cases')->willReturn($this->cases());
    $adapter->method('blueprint')->willReturn('immutable Blueprint');
    $adapter->expects($this->never())->method('execute');
    $form = new CustomerAdapterForm($adapter);
    $form->setStringTranslation($this->getStringTranslationStub());
    $state = new FormState();
    $built = $form->buildForm([], $state);
    $this->assertSame('pixiecore_customer_adapter_demo', $form->getFormId());
    $this->assertSame('json', $built['case_id']['#default_value']);
    $state->set('adapter_result', [
      'case_id' => 'json',
      'blueprint_sha256' => hash('sha256', 'immutable Blueprint'),
      'data' => ['customer_tier' => 'Gold', 'purchase_amount' => 1200],
    ]);
    $state->setValue('case_id', 'csv');
    $state->setTriggeringElement(['#adapter_operation' => 'view']);
    $form->submitForm($built, $state);
    $viewed = $form->buildForm([], $state);
    $this->assertSame('csv', $viewed['case_id']['#default_value']);
    $this->assertSame($this->cases()['csv']['inputs']['source_text'], $viewed['source']['text']['text']['#plain_text']);
    $this->assertSame('Not executed for this case. Click Execute.', $viewed['result']['#default_value']);
    $this->assertTrue($state->isRebuilding());
  }

  /**
   * Tests one Execute stores the result only for its case and Blueprint hash.
   */
  public function testExecuteShowsCurrentResultAndReviewNotice(): void {
    $adapter = $this->createMock(CustomerAdapterDemoInterface::class);
    $adapter->method('cases')->willReturn($this->cases());
    $adapter->method('blueprint')->willReturn('immutable Blueprint');
    $record = [
      'case_id' => 'missing',
      'blueprint_sha256' => hash('sha256', 'immutable Blueprint'),
      'status' => 'review_required',
      'data' => ['error' => 'missing_fields'],
    ];
    $adapter->expects($this->once())->method('execute')->with('missing')->willReturn($record);
    $form = new CustomerAdapterForm($adapter);
    $form->setStringTranslation($this->getStringTranslationStub());
    $state = new FormState();
    $state->setValue('case_id', 'missing');
    $state->setTriggeringElement(['#adapter_operation' => 'execute']);
    $built = [];
    $form->submitForm($built, $state);
    $executed = $form->buildForm([], $state);
    $this->assertStringContainsString('missing_fields', $executed['result']['#default_value']);
    $this->assertStringContainsString('要確認', $executed['notice']['#plain_text']);
    $state->set('selected_case', 'ambiguous');
    $changed = $form->buildForm([], $state);
    $this->assertSame('Not executed for this case. Click Execute.', $changed['result']['#default_value']);
    $state->set('selected_case', 'missing');
    $state->set('adapter_result', array_replace($record, ['blueprint_sha256' => 'old-hash']));
    $stale = $form->buildForm([], $state);
    $this->assertSame('Not executed for this case. Click Execute.', $stale['result']['#default_value']);
  }

}
