# HomeOps container

Deployment source: https://github.com/a-huy/Whisparr-Eros, branch `homeops/stable`.
Clone that repository and check out the exact release commit before building;
record that GitHub URL and commit in `manifest.json` and retain a source archive.
The GitLab repository is historical and is no longer the deployment source.

This image bundles the fork's backend and frontend. It retains the pinned Hotio Alpine container integration and replaces `/app/bin` with a self-contained `linux-musl-x64` release. No host UI overlay is needed. Built-in automatic updates are disabled; deploy a rebuilt fork image for updates.

From a clean checkout, build the UI with `yarn build`. Publish `src/NzbDrone.Console/Whisparr.Console.csproj` and `src/NzbDrone.Mono/Whisparr.Mono.csproj` using .NET 10, Release, `net10.0`, `linux-musl-x64`, `--self-contained true`, `-p:Platform=Posix`, `-p:AssemblyVersion=3.6.5.1888` and `-p:AssemblyConfiguration=homeops`. Use separate output directories, then merge the Mono output into the Console output and copy `_output/UI` into its `UI/` subdirectory. That combined directory is `bin/` in the Docker build context. Copy `LICENSE.md` into `bin/` as well.

Build this Dockerfile from that context with `REVISION` set to the exact source commit and `VERSION=3.6.5.1888`. HomeOps tags the image `homenet/whisparr:<short source commit>`, retains the release archive and checksums on Nyx, and pins that tag in inventory. This tag is local to Nyx; rebuilding or loading the saved image is required on a new host. The generic Arr upgrade helper must not replace this image with an upstream release.

Before cutover, test startup and read-only APIs against a SQLite backup in a network-isolated container. Stop only Whisparr for its final configuration backup, save the installed Compose file, remove its old UI mount, and recreate only Whisparr. Rollback uses the retained image, Compose file and stopped-state configuration snapshot.

This fork includes stable upstream `v3.6.5-release.1886` plus upstream's `f00195e4b630ce64e9e3195b6c99945cd46af970` dependency fix, pinning `System.Security.Cryptography.Pkcs` to `10.0.13`. Build and validation retain NuGet auditing; the original 3.6.2 deployment's command-line audit override is no longer needed.

The upstream frontend now uses Vite and `*.module.css`. Build the isolated import regression with `yarn vite build --config frontend/tests/manual-import/vite.config.mts`, then run `node frontend/tests/manual-import/matching.cjs` and `NODE_PATH=/path/to/playwright/node_modules node frontend/tests/manual-import/browser.cjs`. The browser fixture intercepts all API calls and checks 10,001 manual-import files, 1,001 library-import files, cross-page selections/edits, conservative matching, queue imports from multiple downloads, Cancel/Start Processing and batch refresh/error recovery.

Migration 248 keeps the oldest import row per root folder and path, then adds a unique index. Root-folder refreshes are serialized per folder, with set-based reconciliation. Deploy only after testing this migration against an application backup; rollback requires restoring the stopped-state configuration snapshot.
