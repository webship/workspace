#!/usr/bin/env bash

# AI provider keys for the sites this workspace builds.
#
# settings.yml carries an `ai_providers:` map (openai, anthropic, gemini, …)
# that parse_yaml flattens into $ai_providers_<provider>_api_key. The committed
# file ships placeholders; a developer's real keys live only in their own
# checkout. These helpers push those keys into an installed Drupal site that
# carries the AI stack (Drupal CMS AI, Varbase AI), so "build me a Drupal CMS
# site with AI working" is one command instead of console clicking.

# A value counts as configured only when it is non-empty and not a placeholder.
function ai_provider_key_is_real() {
  case "$1" in
    ''|CHANGE_ME|sk-change-this) return 1 ;;
    *) return 0 ;;
  esac
}

# Store one provider key on the installed site and point the AI provider
# module at it. Uses the Key module (how Drupal CMS AI stores secrets):
# a `key` config entity holds the value, and ai_provider_<name>.settings
# references it by id. Runs inside the project's DDEV containers only.
#
#   set_one_ai_provider_key <provider> <api_key>
function set_one_ai_provider_key() {
  local provider="$1";
  local api_key="$2";
  local module="ai_provider_${provider}";

  if ! ddev drush pm:list --field=name --status=enabled 2>/dev/null | grep -qx "${module}" ; then
    echo "  ${module} is not enabled — skipping the ${provider} key." ;
    return 0 ;
  fi

  # The Key entity. The value travels on STDIN, so it never appears in a
  # command line, shell history, or process list.
  printf '%s' "${api_key}" | ddev drush php:eval "
      \$value = trim(file_get_contents('php://stdin'));
      \$storage = \Drupal::entityTypeManager()->getStorage('key');
      \$id = '${provider}_api_key';
      \$key = \$storage->load(\$id) ?: \$storage->create(['id' => \$id, 'label' => '${provider} API key', 'key_type' => 'authentication']);
      \$key->set('key_provider', 'config');
      \$key->set('key_provider_settings', ['key_value' => \$value]);
      \$key->save();
    " || return 1 ;

  ddev drush -y config:set "${module}.settings" api_key "${provider}_api_key" || return 1 ;
  echo "  ${provider}: key stored and wired to ${module}." ;
}

# Wire every configured provider into the current project's site. Call it
# after install, from the project directory (like enable_*_extra_components).
# Quietly does nothing when the site has no AI stack or no real keys are set.
function set_ai_provider_keys() {
  if ! ddev drush pm:list --field=name --status=enabled 2>/dev/null | grep -qx "key" ; then
    echo "No Key module on this site — skipping AI provider keys." ;
    return 0 ;
  fi

  echo "Wiring AI provider keys from settings.yml (placeholders are skipped).";

  if ai_provider_key_is_real "${ai_providers_openai_api_key}" ; then
    set_one_ai_provider_key "openai" "${ai_providers_openai_api_key}" ;
  fi
  if ai_provider_key_is_real "${ai_providers_anthropic_api_key}" ; then
    set_one_ai_provider_key "anthropic" "${ai_providers_anthropic_api_key}" ;
  fi
  if ai_provider_key_is_real "${ai_providers_gemini_api_key}" ; then
    set_one_ai_provider_key "gemini" "${ai_providers_gemini_api_key}" ;
  fi
}
