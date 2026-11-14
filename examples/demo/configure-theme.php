<?php

/**
 * @file
 * Applies the core Claro appearance to fresh and existing demo sites.
 */

declare(strict_types=1);

use Drupal\user\Entity\Role;

$changed = FALSE;
$modules = \Drupal::service('module_handler');
if (!$modules->moduleExists('block')) {
  \Drupal::service('module_installer')->install(['block']);
  $changed = TRUE;
}
$themes = \Drupal::service('theme_handler');
if (!$themes->themeExists('claro')) {
  \Drupal::service('theme_installer')->install(['claro']);
  $changed = TRUE;
}
$theme_config = \Drupal::configFactory()->getEditable('system.theme');
if ($theme_config->get('default') !== 'claro' || $theme_config->get('admin') !== 'claro') {
  $theme_config->set('default', 'claro')->set('admin', 'claro')->save();
  $changed = TRUE;
}
$role = Role::load('demo');
if (!$role) {
  throw new RuntimeException('Demo role is missing; preserve the state for inspection.');
}
if (!$role->hasPermission('view the administration theme')) {
  $role->grantPermission('view the administration theme')->save();
  $changed = TRUE;
}
if ($changed) {
  drupal_flush_all_caches();
}
