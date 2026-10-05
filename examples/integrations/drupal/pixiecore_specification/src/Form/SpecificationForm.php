<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\pixiecore_specification\Blueprint\DiscountBlueprint;
use Drupal\pixiecore_specification\Blueprint\DiscountBlueprintInterface;
use Drupal\pixiecore_specification\Execution\SpecificationExecutorInterface;
use Drupal\pixiecore_specification\Storage\RevisionStoreInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Provides a CSRF-protected editor using Drupal's required form adapter.
 */
final class SpecificationForm extends FormBase {

  /**
   * Constructs the form by composition around storage and execution services.
   */
  public function __construct(
    protected DiscountBlueprintInterface $blueprint,
    protected RevisionStoreInterface $store,
    protected SpecificationExecutorInterface $executor,
    protected AccountProxyInterface $account,
    protected MessengerInterface $messages,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('pixiecore_specification.blueprint'),
      $container->get('pixiecore_specification.store'),
      $container->get('pixiecore_specification.execution'),
      $container->get('current_user'),
      $container->get('messenger'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'pixiecore_specification_demo';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $uid = (int) $this->account->id();
    $saved = $this->store->latest($uid);
    $instruction = $saved['instruction'] ?? $this->blueprint->defaultBlueprint();
    $revision = $saved['revision'] ?? 0;
    $hasSavedInputs = is_string($saved['inputs_json'] ?? NULL);
    $result = $this->store->latestRun($uid);
    $currentResult = $result !== NULL && ($result['revision'] ?? NULL) === $revision;
    $resultText = $currentResult
      ? json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
      : ($revision === 0
        ? 'Not executed yet. Save the Blueprint, then click Execute.'
        : 'Not executed for saved revision ' . $revision . '. Click Execute.');
    $resultNotice = $currentResult
      ? 'This result belongs to the current saved revision.'
      : 'No result belongs to the current saved revision.';
    $form['#cache']['max-age'] = 0;
    $form['#attached']['library'][] = 'pixiecore_specification/editor';
    $form['#attributes']['data-specification-editor'] = '';
    $mode = $this->executor->mode();
    $modeDetail = 'Offline contract rehearsal; model accuracy is not measured.';
    $form['mode'] = [
      '#type' => 'item',
      '#title' => $this->t('Mode'),
      '#plain_text' => strtoupper($mode) . ' | ' . $modeDetail,
    ];
    $form['panes'] = [
      '#type' => 'container',
      '#attributes' => ['class' => ['specification-panes']],
    ];
    $form['panes']['editor'] = ['#type' => 'container'];
    $left = &$form['panes']['editor'];
    $left['revision'] = [
      '#type' => 'hidden',
      '#default_value' => $revision,
    ];
    $left['inputs'] = [
      '#type' => 'codemirror',
      '#title' => $this->t('Synthetic input JSON'),
      '#default_value' => $saved['inputs_json'] ?? DiscountBlueprint::DEFAULT_INPUTS,
      '#rows' => 2,
      '#codemirror' => [
        'mode' => 'application/json',
        'lineNumbers' => TRUE,
        'toolbar' => FALSE,
      ],
      '#attributes' => ['data-specification-inputs' => ''],
      '#description' => $this->t('Save stores both these inputs and the Blueprint together. Execute uses that saved revision.'),
    ];
    $left['instruction'] = [
      '#type' => 'codemirror',
      '#title' => $this->t('Blueprint (YAML)'),
      '#default_value' => $instruction,
      '#required' => TRUE,
      '#rows' => 18,
      '#codemirror' => [
        'mode' => 'yaml',
        'lineNumbers' => TRUE,
        'toolbar' => FALSE,
      ],
      '#attributes' => ['data-specification-instruction' => ''],
      '#description' => $this->t('Edit the complete Blueprint YAML, then Save and Execute. The YAML is sent to PixieCore as the Blueprint; Drupal does not reinterpret its prompt.'),
    ];
    $left['saved'] = [
      '#type' => 'item',
      '#title' => $this->t('Saved specification'),
      '#plain_text' => 'Revision ' . $revision . ' | ' . ($saved['source_hash'] ?? 'Not saved'),
    ];
    $left['dirty'] = [
      '#type' => 'container',
      '#attributes' => ['data-specification-dirty' => '', 'aria-live' => 'polite'],
      'text' => ['#plain_text' => $hasSavedInputs ? 'Saved' : 'Save inputs and Blueprint before Execute'],
    ];
    $left['actions'] = ['#type' => 'actions'];
    $labels = [
      'save' => $this->t('Save'),
      'execute' => $this->t('Execute'),
      'reset' => $this->t('Reset to initial Blueprint'),
    ];
    foreach ($labels as $operation => $label) {
      $left['actions'][$operation] = [
        '#type' => 'submit',
        '#value' => $label,
        '#name' => $operation,
        '#specification_operation' => $operation,
      ];
    }
    $left['actions']['execute']['#disabled'] = !$hasSavedInputs || $this->executor->mode() === 'disabled';
    $left['actions']['execute']['#attributes']['data-specification-execute'] = '';
    $left['actions']['reset']['#limit_validation_errors'] = [['revision']];
    $form['panes']['result'] = [
      '#type' => 'container',
      'heading' => ['#type' => 'html_tag', '#tag' => 'h2', '#value' => $this->t('Runtime result')],
      'json' => [
        '#type' => 'codemirror',
        '#title' => $this->t('JSON'),
        '#default_value' => $resultText,
        '#disabled' => TRUE,
        '#rows' => 18,
        '#codemirror' => [
          'mode' => 'application/json',
          'lineNumbers' => TRUE,
          'readOnly' => TRUE,
          'toolbar' => FALSE,
        ],
        '#attributes' => ['data-specification-current-result' => ''],
      ],
      'revision_notice' => ['#plain_text' => $resultNotice],
    ];
    if ($result !== NULL && !$currentResult) {
      $form['panes']['result']['previous'] = [
        '#type' => 'details',
        '#title' => $this->t('Previous execution (revision @revision)', ['@revision' => $result['revision']]),
        'json' => [
          '#type' => 'codemirror',
          '#title' => $this->t('JSON'),
          '#default_value' => json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
          '#disabled' => TRUE,
          '#rows' => 18,
          '#codemirror' => [
            'mode' => 'application/json',
            'lineNumbers' => TRUE,
            'readOnly' => TRUE,
            'toolbar' => FALSE,
          ],
        ],
      ];
    }
    $form['complete'] = [
      '#type' => 'details',
      '#title' => $this->t('Complete saved Blueprint sent to PixieCore'),
      'yaml' => [
        '#type' => 'html_tag',
        '#tag' => 'pre',
        'text' => ['#plain_text' => $saved['blueprint'] ?? 'Save to create the complete Blueprint.'],
      ],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $operation = $form_state->getTriggeringElement()['#specification_operation'] ?? '';
    if ($operation === 'reset') {
      return;
    }
    try {
      $this->blueprint->build((string) $form_state->getValue('instruction'));
    }
    catch (\InvalidArgumentException $error) {
      $form_state->setErrorByName('instruction', $error->getMessage());
    }
    try {
      $this->blueprint->inputs((string) $form_state->getValue('inputs'));
    }
    catch (\InvalidArgumentException $error) {
      $form_state->setErrorByName('inputs', $error->getMessage());
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $uid = (int) $this->account->id();
    $revision = (int) $form_state->getValue('revision');
    $instruction = (string) $form_state->getValue('instruction');
    $operation = $form_state->getTriggeringElement()['#specification_operation'] ?? '';
    try {
      if ($operation === 'execute') {
        $result = $this->executor->execute($uid, $revision, $instruction, (string) $form_state->getValue('inputs'));
        if ($result['status'] !== 'unverified') {
          $this->messages->addError($this->t('Runtime request or response validation failed. See the saved execution record.'));
          $form_state->setRedirect('pixiecore_specification.demo');
          return;
        }
        $form_state->setRedirect('pixiecore_specification.demo');
        return;
      }
      if (!in_array($operation, ['save', 'reset'], TRUE)) {
        throw new \InvalidArgumentException('Unknown operation.');
      }
      $instruction = $operation === 'reset' ? $this->blueprint->defaultBlueprint() : $instruction;
      $inputsJson = $operation === 'reset' ? DiscountBlueprint::DEFAULT_INPUTS : (string) $form_state->getValue('inputs');
      $saved = $this->executor->save($uid, $revision, $instruction, $inputsJson);
      $this->messages->addStatus($this->t('Saved revision @revision without a provider request.', ['@revision' => $saved['revision']]));
      $form_state->setRedirect('pixiecore_specification.demo');
    }
    catch (\RuntimeException $error) {
      $this->messages->addError($error->getMessage());
      $form_state->setRebuild();
    }
  }

}
