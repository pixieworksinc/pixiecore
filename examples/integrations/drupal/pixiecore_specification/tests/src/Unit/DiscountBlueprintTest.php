<?php

declare(strict_types=1);

namespace Drupal\Tests\pixiecore_specification\Unit;

use Drupal\Component\Serialization\Yaml;
use Drupal\Component\Utility\NestedArray;
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
   * Tests undeclared references are rejected before a revision is saved.
   */
  #[DataProvider('undeclaredReferences')]
  public function testRejectsUndeclaredPromptReference(string $reference): void {
    $builder = new DiscountBlueprint();
    $source = str_replace('{{ customer_tier }}', $reference, $builder->defaultBlueprint());
    $this->expectException(\InvalidArgumentException::class);
    $builder->build($source);
  }

  /**
   * Provides both supported placeholder syntaxes with undeclared names.
   */
  public static function undeclaredReferences(): array {
    return [
      'Mustache typo' => ['{{ customer_teir }}'],
      'legacy placeholder' => ['{ region }'],
    ];
  }

  /**
   * Tests Save rejects revisions that would fail before runtime execution.
   */
  #[DataProvider('invalidBlueprintValues')]
  public function testRejectsRuntimeIncompatibleBlueprint(
    array $path,
    mixed $value,
  ): void {
    $builder = new DiscountBlueprint();
    $blueprint = Yaml::decode($builder->defaultBlueprint());
    NestedArray::setValue($blueprint, $path, $value);

    $this->expectException(\InvalidArgumentException::class);
    $builder->build(Yaml::encode($blueprint));
  }

  /**
   * Provides wrong types, scalar settings, mappings, and unknown schema keys.
   */
  public static function invalidBlueprintValues(): array {
    return [
      'customer tier must be a string' => [['input_placeholders', 0, 'type'], 'number'],
      'purchase amount must be a number' => [['input_placeholders', 1, 'type'], 'string'],
      'quoted temperature is not numeric YAML' => [['temperature'], '0'],
      'null temperature is not numeric YAML' => [['temperature'], NULL],
      'null model is not a model name' => [['model'], NULL],
      'model override is not allowed' => [['model'], 'unapproved-model'],
      'unregistered runtime role' => [['role'], 'reviewer'],
      'null examples are not a sequence' => [['examples'], NULL],
      'placeholder description must be text' => [['input_placeholders', 0, 'description'], NULL],
      'placeholders must be a sequence' => [
        ['input_placeholders'],
        [
          'first' => ['name' => 'customer_tier', 'type' => 'string', 'required' => TRUE],
          'second' => ['name' => 'purchase_amount', 'type' => 'number', 'required' => TRUE],
        ],
      ],
      'examples must be a sequence' => [
        ['examples'],
        [
          'first' => [
            'input' => ['customer_tier' => 'Gold', 'purchase_amount' => 1500],
            'output' => ['discount' => 0.20, 'final_price' => 1200],
          ],
        ],
      ],
      'input schema cannot add an invalid keyword' => [
        ['input_schema', 'properties', 'purchase_amount', 'multipleOf'],
        'invalid',
      ],
      'output schema cannot add an invalid keyword' => [
        ['output_schema', 'properties', 'discount', 'multipleOf'],
        'invalid',
      ],
    ];
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
      ['{"customer_tier":"\u00a0","purchase_amount":1200}'],
      ['{"customer_tier":"\ufeff","purchase_amount":1200}'],
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
   * Tests schema maxLength counts supplementary characters as code points.
   */
  public function testAcceptsSupplementaryUnicodeTier(): void {
    $tier = str_repeat("\u{1F600}", 21);
    $json = json_encode([
      'customer_tier' => $tier,
      'purchase_amount' => 1200,
    ], JSON_THROW_ON_ERROR);
    $this->assertSame($tier, (new DiscountBlueprint())->inputs($json)['customer_tier']);
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
