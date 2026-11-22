# The tests image of the Webship Workspace's container runtimes (Docker Compose, Podman, Kubernetes): Node.js 24, in
# line with every build, and the shared libraries Playwright's chromium links against. A project's webship-js suite
# (npm, npx, node, yarn) runs in a container of this image, beside the project's own containers, on the host's
# network. The browsers themselves and npm's cache live in the volume mounted at /cache, shared by every project, so
# each Playwright version downloads its browser once and no version removes another's (PLAYWRIGHT_SKIP_BROWSER_GC).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl \
  && npx --yes playwright@1.58 install-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm \
  && mkdir -p /cache && chmod 1777 /cache
ENV HOME=/tmp PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright PLAYWRIGHT_SKIP_BROWSER_GC=1 npm_config_cache=/cache/npm \
    npm_config_update_notifier=false
