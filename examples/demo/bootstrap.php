<?php

/**
 * @file
 * Initializes only a fresh, isolated demo site. Invoked by Drush after install.
 */

declare(strict_types=1);

use Drupal\user\Entity\Role;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;

$name = getenv('DEMO_USER') ?: 'demo';
if (!preg_match('/\A[a-z][a-z0-9_-]{2,31}\z/', $name) || $name === 'site-admin') {
  throw new RuntimeException('Invalid DEMO_USER.');
}
$password = trim(file_get_contents('/run/secrets/demo_password'));
if (strlen($password) < 20 || strlen($password) > 200) {
  throw new RuntimeException('Invalid password file.');
}
Role::create(['id' => 'demo', 'label' => 'Blueprint demo'])
  ->grantPermission('use pixiecore specification demo')->save();
User::create(['name' => $name, 'pass' => $password, 'status' => 1, 'roles' => ['demo']])->save();
User::load(1)->block()->save();
\Drupal::configFactory()->getEditable('user.settings')
  ->set('register', UserInterface::REGISTER_ADMINISTRATORS_ONLY)->save();
\Drupal::configFactory()->getEditable('codemirror_editor.settings')
  ->set('cdn', FALSE)->set('minified', FALSE)->set('theme', 'dracula')->save();
\Drupal::configFactory()->getEditable('system.performance')
  ->set('css.preprocess', FALSE)->set('js.preprocess', FALSE)->save();
\Drupal::configFactory()->getEditable('automated_cron.settings')->set('interval', 0)->save();
