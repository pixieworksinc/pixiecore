<?php

declare(strict_types=1);

namespace Drupal\pixiecore_specification\Controller;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Routing\TrustedRedirectResponse;
use Drupal\Core\Site\Settings;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

/**
 * Provides the landing and trusted-mode Agent pages.
 */
final class DemoPagesController implements DemoPagesControllerInterface, ContainerInjectionInterface {

  /**
   * Constructs pages using trusted deployment settings.
   */
  public function __construct(private readonly Settings $settings) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('settings'));
  }

  /**
   * {@inheritdoc}
   */
  public function landing(): array {
    return [
      '#theme' => 'pixiecore_demo_landing',
      '#attached' => ['library' => ['pixiecore_specification/landing']],
      '#cache' => ['contexts' => ['route', 'theme']],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function replay(Request $request): array|Response {
    if ($this->settings->get('pixieagent_demo_live', FALSE) !== TRUE) {
      return $this->savedReplay();
    }
    $origin = $this->liveOrigin();
    if ($request->getSchemeAndHttpHost() !== $origin || $request->getPathInfo() !== '/pixieagent/') {
      // Drupal's redirect subscriber must not replace the canonical target.
      $request->query->remove('destination');
      $response = new TrustedRedirectResponse($origin . '/pixieagent/', 302, ['Cache-Control' => 'no-store, private']);
      $response->getCacheableMetadata()->setCacheMaxAge(0);
      return $response;
    }
    return $this->agentPage(TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function savedReplay(): array {
    return $this->agentPage(FALSE);
  }

  /**
   * Builds either canonical page with route-specific libraries and CSP.
   */
  private function agentPage(bool $live): array {
    $variant = $live ? 'live' : 'replay';
    $connections = $live ? "'self'" : "'none'";
    $policy = "default-src 'none'; script-src 'self'; style-src 'self'; "
      . "img-src 'self' data:; font-src 'self'; connect-src $connections; "
      . "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    return [
      '#theme' => 'pixiecore_demo_' . $variant,
      '#attached' => [
        'library' => ['pixiecore_specification/' . $variant],
        'http_header' => [
          ['Content-Security-Policy', $policy, TRUE],
          ['X-Frame-Options', 'DENY', TRUE],
        ],
      ],
      '#cache' => ['contexts' => ['route', 'theme'], 'max-age' => 0],
    ];
  }

  /**
   * Validates a trusted origin before rendering a page that can authenticate.
   */
  private function liveOrigin(): string {
    $origin = $this->settings->get('pixieagent_demo_origin', '');
    if (!is_string($origin)
      || !preg_match('@\Ahttps?://(?:\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?\z@', $origin)
      || !filter_var($origin, FILTER_VALIDATE_URL)) {
      throw new ServiceUnavailableHttpException(NULL, 'The Agent origin is not configured correctly.');
    }
    $parts = parse_url($origin);
    $scheme = $parts['scheme'];
    $host = strtolower($parts['host']);
    if ($scheme === 'http' && !in_array($host, ['localhost', '127.0.0.1', '[::1]'], TRUE)) {
      throw new ServiceUnavailableHttpException(NULL, 'Public Agent origins require HTTPS.');
    }
    $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
    if ($port < 1) {
      throw new ServiceUnavailableHttpException(NULL, 'The Agent origin port is invalid.');
    }
    $port_suffix = $port === ($scheme === 'https' ? 443 : 80) ? '' : ':' . $port;
    return $scheme . '://' . $host . $port_suffix;
  }

}
