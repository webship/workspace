# Test

Where we do testing and functional automated testing.



**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync test reports** button) pushes the test reports, failure screenshots and recordings of each project (not the projects) to the `test` folder of your Drive, as `<project>/<module>/reports|screenshots|videos`; new and changed files only, never deleting. `--dry-run` previews, `--item <project>` pushes one project. Settings: `google_drive:` in `core/config/settings.yml`.
