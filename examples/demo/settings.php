<?php

/**
 * @file
 * Isolated offline demo settings; persistent records live outside the image.
 */

declare(strict_types=1);

$databases['default']['default'] = [
  'driver' => 'sqlite',
  'namespace' => 'Drupal\sqlite\Driver\Database\sqlite',
  'autoload' => 'core/modules/sqlite/src/Driver/Database/sqlite/',
  'database' => '/state/site.sqlite',
  'prefix' => '',
];
$settings['hash_salt'] = is_file('/state/hash-salt') ? trim(file_get_contents('/state/hash-salt')) : '';
$hosts = explode(',', getenv('DEMO_HOSTS') ?: 'localhost,127.0.0.1');
foreach ($hosts as $host) {
  if (!preg_match('/\A[a-zA-Z0-9.-]+\z/', $host)) {
    throw new RuntimeException('Invalid DEMO_HOSTS hostname.');
  }
}
$settings['trusted_host_patterns'] = array_map(static fn(string $host): string => '^' . preg_quote($host, '/') . '$', $hosts);
$settings['file_public_path'] = 'sites/default/files';
$settings['file_private_path'] = '/state/private';
$settings['config_sync_directory'] = '/state/config';
$settings['file_temp_path'] = '/tmp';
$settings['skip_permissions_hardening'] = TRUE;
$settings['update_free_access'] = FALSE;
// This image's nginx maps prefixed replay libraries to the Drupal web root.
$settings['pixiecore_demo_replay_asset_prefix'] = TRUE;
$settings['pixiecore_specification'] = [
  'mode' => 'mock',
  'endpoint' => 'http://127.0.0.1:3087',
  'token' => '',
];

// This separate operation never consumes the Core or Agent live trial allowance.
$settings['pixiecore_adapter'] = ['endpoint' => 'http://127.0.0.1:3088'];

// Real mode is an explicit Compose overlay; the provider key stays outside PHP.
if (getenv('DEMO_MODE') === 'real') {
  $token = trim(file_get_contents('/run/secrets/runtime_token') ?: '');
  if (strlen($token) < 32) {
    throw new RuntimeException('The live runtime transport token is unavailable.');
  }
  $settings['pixiecore_specification']['mode'] = 'real';
  $settings['pixiecore_specification']['allow_live'] = TRUE;
  $settings['pixiecore_specification']['token'] = $token;
}

// Agent live UI is selected only by trusted environment, with its own origin.
$settings['pixieagent_demo_live'] = getenv('PIXIEAGENT_MODE') === 'real';
$settings['pixieagent_demo_origin'] = getenv('PIXIEAGENT_ORIGIN') ?: '';
