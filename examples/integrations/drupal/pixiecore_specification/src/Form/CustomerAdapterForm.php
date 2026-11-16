<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\pixiecore_specification\Adapter\CustomerAdapterDemoInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Shows fixed customer inputs and the actual offline runtime response.
 */
final class CustomerAdapterForm extends FormBase {

  /**
   * Constructs the form around the offline adapter boundary.
   *
   * Protected services participate in FormBase's form-cache serialization.
   */
  public function __construct(protected CustomerAdapterDemoInterface $adapter) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('pixiecore_specification.adapter'));
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'pixiecore_customer_adapter_demo';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $cases = $this->adapter->cases();
    $selected = $form_state->get('selected_case') ?? 'json';
    $case = $cases[$selected] ?? $cases['json'];
    $blueprint = $this->adapter->blueprint();
    $hash = hash('sha256', $blueprint);
    $result = $form_state->get('adapter_result');
    $current = is_array($result) && ($result['case_id'] ?? NULL) === $case['id']
      && ($result['blueprint_sha256'] ?? NULL) === $hash;
    $form['#cache']['max-age'] = 0;
    $form['#attached']['library'][] = 'pixiecore_specification/editor';
    $form['#attributes']['data-adapter-demo'] = '';
    $form['mode'] = [
      '#type' => 'item',
      '#title' => $this->t('OFFLINE FIXTURE'),
      '#plain_text' => 'Fixed synthetic responses through PixieCore. No real model is called. Model accuracy has not been evaluated.',
    ];
    $form['case_id'] = [
      '#type' => 'select',
      '#title' => $this->t('Synthetic input case'),
      '#options' => array_map(static fn(array $item): string => $item['label'], $cases),
      '#default_value' => $case['id'],
      '#required' => TRUE,
      '#description' => $this->t('Choose a case and View input. Only Execute sends a request to the local fixture runtime.'),
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['view'] = [
      '#type' => 'submit',
      '#name' => 'view',
      '#value' => $this->t('View input'),
      '#adapter_operation' => 'view',
    ];
    $form['actions']['execute'] = [
      '#type' => 'submit',
      '#name' => 'execute',
      '#value' => $this->t('Execute'),
      '#adapter_operation' => 'execute',
    ];
    $form['source'] = [
      '#type' => 'item',
      '#title' => $this->t('Original input (@format)', ['@format' => $case['inputs']['source_format']]),
      'text' => [
        '#type' => 'html_tag',
        '#tag' => 'pre',
        '#attributes' => ['data-adapter-source' => ''],
        'text' => ['#plain_text' => $case['inputs']['source_text']],
      ],
    ];
    $notice = $current && ($result['status'] ?? '') === 'review_required'
      ? 'Review required (要確認). Missing or ambiguous information was not filled in.'
      : 'Result and checks for the selected case. Fixture agreement does not measure model accuracy.';
    $form['notice'] = ['#plain_text' => $notice];
    $form['result'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Runtime result and checks'),
      '#default_value' => $current
        ? json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
        : 'Not executed for this case. Click Execute.',
      '#disabled' => TRUE,
      '#rows' => 18,
      '#attributes' => ['data-adapter-result' => ''],
    ];
    $form['hash'] = [
      '#type' => 'item',
      '#title' => $this->t('Immutable Blueprint SHA-256'),
      '#plain_text' => $hash,
    ];
    $form['blueprint'] = [
      '#type' => 'details',
      '#title' => $this->t('Same complete Blueprint for every input format'),
      'text' => [
        '#type' => 'html_tag',
        '#tag' => 'pre',
        '#attributes' => ['data-adapter-blueprint' => ''],
        'text' => ['#plain_text' => $blueprint],
      ],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $caseId = $form_state->getValue('case_id');
    if (!is_string($caseId) || !array_key_exists($caseId, $this->adapter->cases())) {
      $form_state->setErrorByName('case_id', $this->t('Select a bundled adapter case.'));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $caseId = (string) $form_state->getValue('case_id');
    $operation = $form_state->getTriggeringElement()['#adapter_operation'] ?? '';
    $form_state->set('selected_case', $caseId);
    $form_state->set('adapter_result', NULL);
    if ($operation === 'execute') {
      try {
        $form_state->set('adapter_result', $this->adapter->execute($caseId));
      }
      catch (\RuntimeException) {
        $form_state->set('adapter_result', [
          'case_id' => $caseId,
          'blueprint_sha256' => hash('sha256', $this->adapter->blueprint()),
          'status' => 'failed',
          'failure' => 'The offline adapter runtime is unavailable.',
        ]);
      }
    }
    $form_state->setRebuild();
  }

}
