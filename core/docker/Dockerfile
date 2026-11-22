# The Webship Workspace's dashboard, as one image (webship/workspace#694): what the dashboard needs to run on Docker
# Compose (core/docker/compose.yaml) and on Kubernetes (core/k8s), without DDEV.
#
# The app is NOT in this image. The workspace (core/, the folders, the sites) is mounted, at the SAME path it has on
# the host: the dashboard builds sites through the host's Docker (the mounted /var/run/docker.sock), and the Docker
# daemon reads every path it is given (a site's bind mount, a build context) on the HOST. A workspace mounted at
# another path in here would hand the daemon paths that do not exist there. So ~/workspace on the host is
# ~/workspace in the container, and WORKSPACE_ROOT names it.
#
#   docker build -t webship-workspace core/docker
#   docker build -t webship-workspace --build-arg DDEV_VERSION=1.25.2 core/docker     # with the ddev binary
#
# Left out, because only the dashboard's DDEV project needs it: DDEV's web server, PHP, the router shim, code-server,
# supervisor. The ddev binary is left out by default too: a dashboard run from this image builds sites on Docker
# Compose and Kubernetes, not DDEV sites (core/docs/runtimes.md). DDEV_VERSION adds the binary for who wants to try.
ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-bookworm-slim

# git, screen (every command runs in a screen session), python (the builders' arguments, the settings files),
# pandoc (documents and reports), and what the scripts call (curl, jq, rsync, ssh, zip). tini is the init.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini git screen \
       python3 python3-yaml python-is-python3 pandoc jq rsync openssh-client unzip zip less procps gh \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  # The Docker client only, with the compose and buildx plugins: the daemon is the host's.
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin \
  && rm -rf /var/lib/apt/lists/*

# kubectl, for sites on Kubernetes and for the dashboard in a pod. kind, for a local cluster (KIND_VERSION= leaves it out).
ARG KUBECTL_VERSION=v1.37.0
ARG KIND_VERSION=v0.33.0
RUN arch="$(dpkg --print-architecture)" \
  && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" -o /usr/local/bin/kubectl \
  && chmod 0755 /usr/local/bin/kubectl \
  && if [ -n "${KIND_VERSION}" ] ; then \
       curl -fsSL "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-${arch}" -o /usr/local/bin/kind && chmod 0755 /usr/local/bin/kind ; \
     fi

# The Claude Code CLI, for the AI Assistant (it uses the login in the mounted ~/.claude). CLAUDE_CODE=false leaves it out.
ARG CLAUDE_CODE=true
RUN if [ "${CLAUDE_CODE}" = "true" ] ; then npm install -g --no-audit --no-fund @anthropic-ai/claude-code && npm cache clean --force ; fi

# The ddev binary, only when asked for (see the top of this file).
ARG DDEV_VERSION=
RUN if [ -n "${DDEV_VERSION}" ] ; then \
      curl -fsSL "https://github.com/ddev/ddev/releases/download/v${DDEV_VERSION}/ddev_linux-$(dpkg --print-architecture).v${DDEV_VERSION}.tar.gz" \
        | tar -xz -C /usr/local/bin ddev && chmod 0755 /usr/local/bin/ddev ; \
    fi

# The dashboard runs as the HOST's user, by number (compose's `user:`, a pod's runAsUser), so what it writes in the
# workspace belongs to that user. That number has no name in here until the entrypoint gives it one (screen and git
# ask for it), which is why these two files can be written by it. The container already holds the host's Docker
# socket: there is nothing in it to protect from its own user.
# The image's own `node` user (1000) goes, so the name is always the entrypoint's.
RUN userdel -r node 2> /dev/null ; chmod 0666 /etc/passwd /etc/group \
  && mkdir -p /home/webship && chmod 1777 /home/webship \
  # screen's socket directory, usable by any user number.
  && mkdir -p /run/screen && chmod 1777 /run/screen
ENV HOME=/home/webship

COPY dashboard.sh /usr/local/bin/webship-dashboard
RUN chmod 0755 /usr/local/bin/webship-dashboard

EXPOSE 3000
ENTRYPOINT ["tini", "--", "/usr/local/bin/webship-dashboard"]
