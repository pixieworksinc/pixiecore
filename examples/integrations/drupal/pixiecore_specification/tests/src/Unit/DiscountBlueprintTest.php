<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Unit;

use Drupal\Component\Serialization\Yaml;
use Drupal\Tests\UnitTestCase;
use Drupal\pixiecore_specification\Blueprint\DiscountBlueprint;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests complete Blueprint preservation and input/output contract boundaries.
 */
#[Group('pixiecore_specification')]
final class DiscountBlueprintTest extends UnitTestCase {

  /**
   * Tests opaque delivery including whitespace and HTML-like instruction text.
   */
  public function testPreservesCompleteBlueprintAndFixedContract(): void {
    $builder = new DiscountBlueprint();
    $text = $builder->defaultBlueprint();
    $blueprint = Yaml::decode($builder->build($text));
    $this->assertSame($text, $builder->build($text));
    $this->assertSame('assistant', $blueprint['role']);
    $this->assertSame('Apply exactly one customer discount policy to the supplied purchase.', strtok($blueprint['prompt'], "\n"));
    $this->assertSame(0.20, $blueprint['examples'][0]['output']['discount']);
    $this->assertSame(1200, $blueprint['examples'][0]['output']['final_price']);
    $this->assertFalse($blueprint['input_schema']['additionalProperties']);
    $this->assertSame(['discount', 'final_price'], $blueprint['output_schema']['required']);
  }

  /**
   * Tests malformed YAML and a non-Blueprint instruction are rejected.
   */
  public function testRejectsNonBlueprintYaml(): void {
    $this->expectException(\InvalidArgumentException::class);
    (new DiscountBlueprint())->build("Scenario: not a complete Blueprint\n");
  }

  /**
   * Tests input rejection before a transport can run.
   */
  #[DataProvider('invalidInputs')]
  public function testRejectsInvalidInputs(string $json): void {
    $this->expectException(\InvalidArgumentException::class);
    (new DiscountBlueprint())->inputs($json);
  }

  /**
   * Provides malformed, missing, extra, nested, and out-of-range inputs.
   */
  public static function invalidInputs(): array {
    return [
      ['not json'], ['[]'], ['{}'], ['null'],
      ['{"customer_tier":"Gold"}'],
      ['{"customer_tier":"Gold","purchase_amount":"1200"}'],
      ['{"customer_tier":[],"purchase_amount":1200}'],
      ['{"customer_tier":" ","purchase_amount":1200}'],
      ['{"customer_tier":"Gold","purchase_amount":-1}'],
      ['{"customer_tier":"Gold","purchase_amount":1000001}'],
      ['{"customer_tier":"Gold","purchase_amount":1e999}'],
      ['{"customer_tier":"Gold","purchase_amount":1200,"provider":"openai"}'],
      [str_repeat(' ', DiscountBlueprint::MAX_INPUT_BYTES + 1)],
    ];
  }

  /**
   * Tests that invalid output is not confused with business correctness.
   */
  #[DataProvider('invalidResults')]
  public function testRejectsInvalidResult(array $result): void {
    $builder = new DiscountBlueprint();
    $this->expectException(\UnexpectedValueException::class);
    $builder->validateResult($result, $builder->inputs(DiscountBlueprint::DEFAULT_INPUTS));
  }

  /**
   * Provides schema, nonfinite, and arithmetic failures.
   */
  public static function invalidResults(): array {
    return [
      [[]],
      [['discount' => '0.15', 'final_price' => 1020]],
      [['discount' => 2, 'final_price' => 1020]],
      [['discount' => 0.15, 'final_price' => -1]],
      [['discount' => 0.15, 'final_price' => INF]],
      [['discount' => 0.15, 'final_price' => 960]],
      [['discount' => 0.15, 'final_price' => 1020, 'extra' => TRUE]],
    ];
  }

  /**
   * Tests arithmetically consistent model results without measuring the rule.
   */
  public function testAcceptsInitialResults(): void {
    $builder = new DiscountBlueprint();
    $inputs = $builder->inputs(DiscountBlueprint::DEFAULT_INPUTS);
    $builder->validateResult(['discount' => 0.20, 'final_price' => 960], $inputs);
    $builder->validateResult(['discount' => 0, 'final_price' => 1200], $inputs);
    $this->assertSame(1200, $inputs['purchase_amount']);
  }

  /**
   * Tests instruction bounds without requiring a particular authoring syntax.
   */
  public function testRejectsEmptyInstruction(): void {
    $this->expectException(\InvalidArgumentException::class);
    (new DiscountBlueprint())->build('  ');
  }

  /**
   * Tests oversized instructions are rejected before storage or transport.
   */
  public function testRejectsOversizedInstruction(): void {
    $this->expectException(\InvalidArgumentException::class);
    (new DiscountBlueprint())->build(str_repeat('x', DiscountBlueprint::MAX_BLUEPRINT_BYTES + 1));
  }

}
