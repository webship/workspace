# A stack of the Webship Workspace's container runtimes for an application that serves itself, in the language and
# version it chooses (webship/workspace#841): Python, Node.js, Java, .NET, Ruby, Go, or an image of its own. The base
# image is the language's own (pinned to the version, never `latest`); on top of it the layer every stack has: git,
# curl, unzip, the clients of the project's database, msmtp as sendmail to the stack's Mailpit, and the host user's
# UID/GID for www-data, so the project folder is written as on DDEV. A plugin's own additions (rt_web_build) follow
# this file in the project's .webship/runtime/Dockerfile.
ARG BASE_IMAGE=debian:bookworm-slim
FROM ${BASE_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git unzip curl ca-certificates less procps \
      mariadb-client postgresql-client msmtp-mta \
  && rm -rf /var/lib/apt/lists/* \
  && printf 'account default\nhost mail\nport 1025\nfrom noreply@example.com\n' > /etc/msmtprc
ARG UID=1000
ARG GID=1000
# www-data as the host user, as DDEV writes the project's files: the image's own, made where the base has none.
RUN (getent group www-data > /dev/null || groupadd www-data) && (id www-data > /dev/null 2>&1 || useradd -g www-data -d /var/www -s /bin/bash www-data) \
  && groupmod -o -g "${GID}" www-data && usermod -o -u "${UID}" -g "${GID}" -d /var/www -s /bin/bash www-data \
  && mkdir -p /var/www/html && chown www-data:www-data /var/www /var/www/html
WORKDIR /var/www/html
