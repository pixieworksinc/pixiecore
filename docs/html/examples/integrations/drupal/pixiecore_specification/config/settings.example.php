<?php

/**
 * @file
 * Configures a local, offline fixture connection in Drupal settings.php.
 *
 * Include this file only in an isolated demo site, never a production site.
 * No OpenAI key is required. Real execution needs separate trusted settings,
 * a protected backend, and an independently approved provider budget.
 */

$settings['pixiecore_specification'] = [
  'mode' => 'mock',
  'endpoint' => 'http://127.0.0.1:3087',
  'token' => '',
];
