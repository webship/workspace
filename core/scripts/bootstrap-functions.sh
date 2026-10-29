#!/usr/bin/env bash

# Include users functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-users.sh || exit 1 ;

# Include Default settings functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-default-settings.sh || exit 1 ;

# Include Database functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-database.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-ddev-telemetry.sh || exit 1 ;

# Include Files functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-files.sh || exit 1 ;

# Include backup functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-backup-item.sh || exit 1 ;

# Include clone-project functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-clone-project.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-git-worktrees.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-ddev-hostnames.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-hostnames-cli.sh || exit 1 ;

# Include screen-session functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-screen.sh || exit 1 ;

# Include project removal functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-remove-project.sh || exit 1 ;

# Include drush functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-drush.sh || exit 1 ;

# Include distribution functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-build-distribution.sh || exit 1 ;

# Include site template functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-build-site-template.sh || exit 1 ;

# Include graphify (knowledge graph) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-graphify.sh || exit 1 ;

# Include Upsun (cloud) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-upsun.sh || exit 1 ;

# Include AI provider key functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-ai-providers.sh || exit 1 ;

# Include GitLab CI (gitlab-ci-local green-gate) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-gitlab-ci.sh || exit 1 ;

# Include AI item (agents/skills/prompts) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-ai-items.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-ai-items-lock.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-ai-items-sources.sh || exit 1 ;

# Include brand token (Figma) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-brand-tokens.sh || exit 1 ;

# Include workspace command management functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-commands.sh || exit 1 ;

# Include Penpot (self-hosted design platform in DDEV) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-penpot.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-wordpress.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-odoo.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-avatar.sh || exit 1 ;

# Include graphs workspace (the graph store and its MCP wiring) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-graphs.sh || exit 1 ;

# Include Milvus (self-hosted vector database in DDEV) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-milvus.sh || exit 1 ;

# Include RAG index build (ragify) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-ragify.sh || exit 1 ;

# Include rag workspace (the index store and its MCP wiring) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-rag.sh || exit 1 ;

# Include Google Drive (push a workspace folder to a Drive folder, and its MCP server) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-drive-sync.sh || exit 1 ;

# Include automated-testing (set up and run a project's suite) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-testing.sh || exit 1 ;

# The code-quality checks a package already declares (cmd-tools-checks.sh).
source ${WORKSPACE_SCRIPTS}/functions/fun-checks.sh || exit 1 ;

# Reclaiming the disk that removed projects left behind (cmd-tools-reclaim.sh).
source ${WORKSPACE_SCRIPTS}/functions/fun-reclaim.sh || exit 1 ;

# The dashboard's hostnames and its boot service (core/scripts/autostart.sh).
source ${WORKSPACE_SCRIPTS}/functions/fun-autostart.sh || exit 1 ;

# ElevenLabs, for the final voiceover of a narrated video (videos/cmd-tools-elevenlabs.sh).
source ${WORKSPACE_SCRIPTS}/functions/fun-elevenlabs.sh || exit 1 ;

# Voices for the audio workspace: Piper and ElevenLabs (audio/cmd-tools-voice.sh).
source ${WORKSPACE_SCRIPTS}/functions/fun-voice.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-video-edit.sh || exit 1 ;

# Include SPDD (structured-prompt-driven design artifacts) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-spdd.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-specs-share.sh || exit 1 ;

# trim_project_name — the one place PROJECT_NAME gets a trailing slash trimmed, called from every
# cmd-*.sh that takes one.
source ${WORKSPACE_SCRIPTS}/functions/fun-project-name.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-version.sh || exit 1 ;
source ${WORKSPACE_SCRIPTS}/functions/fun-release.sh || exit 1 ;

# Workspace folders kept on a second disk (core/scripts/storage.sh).
source ${WORKSPACE_SCRIPTS}/functions/fun-storage.sh || exit 1 ;
