# The php stack of the Webship Workspace's container runtimes (Docker Compose, Podman, Kubernetes): Apache and PHP
# with the extensions Drupal, WordPress and the other PHP platforms need, Composer, WP-CLI (`ddev wp`, as DDEV's own
# web image carries it), the MariaDB client, and msmtp sending PHP's mail to the stack's Mailpit. Files are written
# as the host user (UID/GID), as DDEV does.
ARG PHP_VERSION=8.3
FROM php:${PHP_VERSION}-apache
RUN apt-get update && apt-get install -y --no-install-recommends git unzip curl patch less mariadb-client msmtp-mta \
      libpng-dev libjpeg62-turbo-dev libfreetype6-dev libwebp-dev libzip-dev libicu-dev libxml2-dev \
  && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
  && docker-php-ext-install -j"$(nproc)" gd pdo_mysql mysqli zip intl opcache bcmath exif \
  && a2enmod rewrite headers expires \
  && mkdir -p /etc/mysql/conf.d && printf '[client]\nskip-ssl\n' > /etc/mysql/conf.d/webship.cnf \
  && for b in mysql mariadb mysqldump mariadb-dump ; do printf '#!/bin/sh\nexec /usr/bin/%s "$@" --skip-ssl\n' "$b" > /usr/local/bin/$b && chmod 755 /usr/local/bin/$b ; done \
  && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
# WP-CLI, at a release that is named: a platform's builder calls it as `ddev wp`. `less` is the pager its help asks for.
ARG WP_CLI_VERSION=2.12.0
RUN curl -fsSL -o /usr/local/bin/wp "https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar" \
  && chmod +x /usr/local/bin/wp && wp --allow-root --version
ARG UID=1000
ARG GID=1000
RUN groupmod -o -g "${GID}" www-data && usermod -o -u "${UID}" -d /var/www www-data && chown www-data:www-data /var/www
# Apache also answers on WEBSHIP_PORT inside the container: on Docker Compose and Podman that is the port the site
# has on the machine (compose.yaml sets it), so the site reaches itself at its own address, http://127.0.0.1:<port>,
# as a platform does for its scheduled tasks and its own checks (WordPress's WP-Cron and Site Health).
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
  && sed -ri -e 's!<VirtualHost \*:80>!<VirtualHost *:80 *:${WEBSHIP_PORT}>!' /etc/apache2/sites-available/000-default.conf \
  && printf 'Listen ${WEBSHIP_PORT}\n' >> /etc/apache2/ports.conf \
  && sed -ri -e 's!AllowOverride None!AllowOverride All!g' /etc/apache2/apache2.conf \
  && printf 'memory_limit=1G\nupload_max_filesize=64M\npost_max_size=64M\nsendmail_path="/usr/bin/msmtp -t --host=mail --port=1025 --from=noreply@example.com"\n' > /usr/local/etc/php/conf.d/webship.ini
ENV APACHE_DOCUMENT_ROOT=/var/www/html WEBSHIP_PORT=8080 COMPOSER_HOME=/tmp/composer PATH=/var/www/html/vendor/bin:/var/www/html/bin:$PATH
WORKDIR /var/www/html
