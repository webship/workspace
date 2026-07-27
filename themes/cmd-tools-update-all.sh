# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.themes.settings.yml);

for project in *; do
    if [ -d "$project" ]; then
    echo "===========================================";
    echo "  $project";
    echo "===========================================";
	cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${project};
	composer update --no-interaction  ;
    fi
done
