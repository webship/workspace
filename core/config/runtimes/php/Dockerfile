# The php stack of the Webship Workspace's container runtimes (Docker Compose, Podman, Kubernetes): Apache and PHP
# with the extensions Drupal, WordPress and the other PHP platforms need, Composer, the MariaDB client, and msmtp
# sending PHP's mail to the stack's Mailpit. Files are written as the host user (UID/GID), as DDEV does.
ARG PHP_VERSION=8.3
FROM php:${PHP_VERSION}-apache
RUN apt-get update && apt-get install -y --no-install-recommends git unzip curl patch mariadb-client msmtp-mta \
      libpng-dev libjpeg62-turbo-dev libfreetype6-dev libwebp-dev libzip-dev libicu-dev libxml2-dev \
  && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
  && docker-php-ext-install -j"$(nproc)" gd pdo_mysql mysqli zip intl opcache bcmath exif \
  && a2enmod rewrite headers expires \
  && mkdir -p /etc/mysql/conf.d && printf '[client]\nskip-ssl\n' > /etc/mysql/conf.d/webship.cnf \
  && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
ARG UID=1000
ARG GID=1000
RUN groupmod -o -g "${GID}" www-data && usermod -o -u "${UID}" -d /var/www www-data && chown www-data:www-data /var/www
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
  && sed -ri -e 's!AllowOverride None!AllowOverride All!g' /etc/apache2/apache2.conf \
  && printf 'memory_limit=1G\nupload_max_filesize=64M\npost_max_size=64M\nsendmail_path="/usr/bin/msmtp -t --host=mail --port=1025 --from=noreply@example.com"\n' > /usr/local/etc/php/conf.d/webship.ini
ENV APACHE_DOCUMENT_ROOT=/var/www/html COMPOSER_HOME=/tmp/composer PATH=/var/www/html/vendor/bin:$PATH
WORKDIR /var/www/html
