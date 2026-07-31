# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.themes.settings.yml);

for project in *; do
    if [ -d "$project" ]; then
    echo "===========================================";
    echo "  $project";
    echo "===========================================";
	cd ${WORKSPACE_ROOT}/${doc_name}/${project};
	composer update --no-interaction  ;
    fi
done
