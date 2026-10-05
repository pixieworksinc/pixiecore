<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Functional;

use Drupal\Tests\BrowserTestBase;
use Drupal\pixiecore_specification\Blueprint\DiscountBlueprint;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Tests Drupal permissions, persistent saves, CSRF, and offline execution.
 */
#[Group('pixiecore_specification')]
#[RunTestsInSeparateProcesses]
final class SpecificationFormTest extends BrowserTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['codemirror_editor', 'pixiecore_integration', 'pixiecore_specification'];

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'stark';

  /**
   * Tests access denial and user-owned revision persistence after reload.
   */
  public function testPermissionsAndSavedOwnership(): void {
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->assertSession()->statusCodeEquals(403);
    $unprivileged = $this->drupalCreateUser();
    $this->drupalLogin($unprivileged);
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->assertSession()->statusCodeEquals(403);
    $owner = $this->drupalCreateUser(['use pixiecore specification demo']);
    $this->drupalLogin($owner);
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->assertSession()->statusCodeEquals(200);
    $this->assertSession()->elementExists('css', 'input[name="form_token"]');
    $page = $this->getSession()->getPage()->getContent();
    $inputsPosition = strpos($page, 'name="inputs"');
    $instructionPosition = strpos($page, 'name="instruction"');
    $this->assertNotFalse($inputsPosition);
    $this->assertNotFalse($instructionPosition);
    $this->assertLessThan($instructionPosition, $inputsPosition);
    $this->assertSame('2', $this->assertSession()->elementExists('css', 'textarea[name="inputs"]')->getAttribute('rows'));
    $this->assertSession()->elementExists('css', 'textarea[name="inputs"][data-codemirror]');
    $this->assertSession()->elementExists('css', 'textarea[name="instruction"][data-codemirror]');
    $this->assertSession()->elementExists('css', 'textarea[name="json"][data-codemirror]');
    $this->submitForm([], 'Save');
    $this->assertSession()->pageTextContains('Saved revision 1');
    $text = str_replace('strictly greater than 1000', 'strictly greater than 2000', (new DiscountBlueprint())->defaultBlueprint());
    $inputs = '{"customer_tier":"Gold","purchase_amount":2000}';
    $this->submitForm(['instruction' => $text, 'inputs' => $inputs], 'Save');
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->assertSession()->fieldValueEquals('instruction', $text);
    $this->assertSession()->fieldValueEquals('inputs', $inputs);
    $this->assertSession()->pageTextContains('Revision 2');
    $other = $this->drupalCreateUser(['use pixiecore specification demo']);
    $this->drupalLogin($other);
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->assertSession()->fieldValueEquals('instruction', (new DiscountBlueprint())->defaultBlueprint());
    $this->assertSession()->pageTextContains('Revision 0');
    $this->assertSession()->fieldValueEquals('inputs', DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Tests the demo is discoverable from Drupal's Configuration page.
   */
  public function testConfigurationMenuLinksToDemo(): void {
    $owner = $this->drupalCreateUser([
      'access administration pages',
      'use pixiecore specification demo',
    ]);
    $this->drupalLogin($owner);
    $this->drupalGet('admin/config');
    $this->assertSession()->statusCodeEquals(200);
    $this->assertSession()->linkByHrefExists('/admin/config/pixiecore/specification');
    $this->assertSession()->linkExists('PixieCore Blueprint demo');
  }

  /**
   * Tests a forged CSRF token cannot save a specification.
   */
  public function testRejectsForgedFormToken(): void {
    $owner = $this->drupalCreateUser(['use pixiecore specification demo']);
    $this->drupalLogin($owner);
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->assertSession()->elementExists('css', 'input[name="form_token"]')->setValue('invalid-token');
    $this->submitForm([], 'Save');
    $this->assertSession()->pageTextContains('The form has become outdated.');
    $store = $this->container->get('pixiecore_specification.store');
    $this->assertNull($store->latest((int) $owner->id()));
  }

  /**
   * Tests JSON validation marks the input field alone.
   */
  public function testInvalidJsonHighlightsInputs(): void {
    $owner = $this->drupalCreateUser(['use pixiecore specification demo']);
    $this->drupalLogin($owner);
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->submitForm(['inputs' => 'not JSON'], 'Save');
    $this->assertSession()->pageTextContains('Inputs must be a JSON object.');
    $this->assertSession()->elementExists('css', 'textarea[name="inputs"].error');
    $this->assertSession()->elementNotExists('css', 'textarea[name="instruction"].error');
    $store = $this->container->get('pixiecore_specification.store');
    $this->assertNull($store->latest((int) $owner->id()));
  }

  /**
   * Tests instruction markup is escaped and Reset retains its revision guard.
   */
  public function testEscapesInstructionAndResetsInvalidInputs(): void {
    $owner = $this->drupalCreateUser(['use pixiecore specification demo']);
    $this->drupalLogin($owner);
    $this->drupalGet('admin/config/pixiecore/specification');
    $text = str_replace('Apply exactly one customer discount policy', '<script id="specification-injection">alert("fixture")</script>', (new DiscountBlueprint())->defaultBlueprint());
    $this->submitForm(['instruction' => $text], 'Save');
    $this->assertSession()->fieldValueEquals('instruction', $text);
    $this->assertSession()->elementNotExists('css', 'script#specification-injection');
    $this->assertSession()->responseContains('&lt;script');
    $this->submitForm(['inputs' => 'not JSON'], 'Reset to initial Blueprint');
    $this->assertSession()->pageTextContains('Saved revision 2');
    $this->assertSession()->fieldValueEquals('instruction', (new DiscountBlueprint())->defaultBlueprint());
    $this->assertSession()->fieldValueEquals('inputs', DiscountBlueprint::DEFAULT_INPUTS);
  }

  /**
   * Keeps a previous run out of the current revision's result pane.
   */
  public function testPreviousResultIsClearlyArchivedAfterSave(): void {
    $owner = $this->drupalCreateUser(['use pixiecore specification demo']);
    $this->drupalLogin($owner);
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->submitForm([], 'Save');

    $store = $this->container->get('pixiecore_specification.store');
    $saved = $store->latest((int) $owner->id());
    $store->record((int) $owner->id(), $saved, [
      'revision' => 1,
      'status' => 'success',
      'data' => ['discount' => 0.15, 'final_price' => 1020],
    ]);

    $text = str_replace('strictly greater than 1000', 'strictly greater than 2000', (new DiscountBlueprint())->defaultBlueprint());
    $this->submitForm(['instruction' => $text], 'Save');
    $currentResult = $this->assertSession()->elementExists('css', 'textarea[data-specification-current-result]')->getHtml();
    $this->assertStringContainsString('Not executed for saved revision 2. Click Execute.', $currentResult);
    $this->assertStringNotContainsString('1020', $currentResult);
    $this->assertSession()->pageTextContains('Previous execution (revision 1)');
  }

  /**
   * Tests two revisions through the actual loopback PixieCore fixture server.
   */
  public function testExecuteThroughOfflineRuntime(): void {
    $endpoint = getenv('PIXIECORE_SPEC_TEST_ENDPOINT');
    if (!$endpoint) {
      $this->markTestSkipped('Start the documented local mock server and set PIXIECORE_SPEC_TEST_ENDPOINT.');
    }
    $this->writeSettings([
      'settings' => [
        'pixiecore_specification' => (object) [
          'value' => ['mode' => 'mock', 'endpoint' => $endpoint, 'token' => ''],
          'required' => TRUE,
        ],
      ],
    ]);
    $owner = $this->drupalCreateUser(['use pixiecore specification demo']);
    $this->drupalLogin($owner);
    $this->drupalGet('admin/config/pixiecore/specification');
    $this->submitForm([], 'Save');
    $this->submitForm([], 'Execute');
    $currentResult = $this->assertSession()->elementExists('css', 'textarea[data-specification-current-result]')->getValue();
    $this->assertStringContainsString('"final_price": 960', $currentResult);
    $this->assertSession()->elementNotExists('css', '.messages--warning');
    $this->assertSession()->pageTextContains('fixture-mock');
    $text = str_replace('strictly greater than 1000', 'strictly greater than 2000', (new DiscountBlueprint())->defaultBlueprint());
    $this->submitForm(['instruction' => $text], 'Save');
    $currentResult = $this->assertSession()->elementExists('css', 'textarea[data-specification-current-result]')->getHtml();
    $this->assertStringContainsString('Not executed for saved revision 2. Click Execute.', $currentResult);
    $this->submitForm([], 'Execute');
    $currentResult = $this->assertSession()->elementExists('css', 'textarea[data-specification-current-result]')->getValue();
    $this->assertStringContainsString('"final_price": 1200', $currentResult);
    $this->assertStringContainsString('"revision": 2', $currentResult);
    $this->assertSession()->pageTextContains('not_measured');
    $this->submitForm([], 'Reset to initial Blueprint');
    $this->submitForm([], 'Execute');
    $currentResult = $this->assertSession()->elementExists('css', 'textarea[data-specification-current-result]')->getValue();
    $this->assertStringContainsString('"final_price": 960', $currentResult);
    $this->assertStringContainsString('"revision": 3', $currentResult);
  }

}
