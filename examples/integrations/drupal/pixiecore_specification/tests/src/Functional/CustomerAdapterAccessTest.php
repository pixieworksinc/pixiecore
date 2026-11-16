<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Functional;

use Drupal\Tests\BrowserTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Tests the adapter uses Drupal's existing permission and CSRF protection.
 */
#[Group('pixiecore_specification')]
#[RunTestsInSeparateProcesses]
final class CustomerAdapterAccessTest extends BrowserTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['codemirror_editor', 'pixiecore_integration', 'pixiecore_specification'];

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'stark';

  /**
   * Tests anonymous denial, permissions, and selection without any runtime.
   */
  public function testPermissionsAndView(): void {
    $this->drupalGet('admin/config/pixiecore/adapter');
    $this->assertSession()->statusCodeEquals(403);
    $this->drupalLogin($this->drupalCreateUser());
    $this->drupalGet('admin/config/pixiecore/adapter');
    $this->assertSession()->statusCodeEquals(403);
    $this->drupalLogin($this->drupalCreateUser(['use pixiecore specification demo']));
    $this->drupalGet('admin/config/pixiecore/adapter');
    $this->assertSession()->statusCodeEquals(200);
    $this->assertSession()->pageTextContains('OFFLINE FIXTURE');
    $this->assertSession()->elementExists('css', 'input[name="form_token"]');
    $this->submitForm(['case_id' => 'csv'], 'View input');
    $this->assertSession()->elementTextContains('css', '[data-adapter-source]', 'Gold,1200');
    $this->assertSession()->fieldValueEquals('result', 'Not executed for this case. Click Execute.');
    $this->assertSession()->pageTextContains('Model accuracy has not been evaluated.');
  }

  /**
   * Tests forged tokens are rejected before the Execute callback.
   */
  public function testRejectsForgedToken(): void {
    $this->drupalLogin($this->drupalCreateUser(['use pixiecore specification demo']));
    $this->drupalGet('admin/config/pixiecore/adapter');
    $this->assertSession()->elementExists('css', 'input[name="form_token"]')->setValue('invalid-token');
    $this->submitForm([], 'Execute');
    $this->assertSession()->pageTextContains('The form has become outdated.');
    $this->assertSession()->fieldValueEquals('result', 'Not executed for this case. Click Execute.');
  }

}
