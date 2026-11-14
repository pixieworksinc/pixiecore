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
$settings['pixiecore_specification'] = [
  'mode' => 'mock',
  'endpoint' => 'http://127.0.0.1:3087',
  'token' => '',
];
