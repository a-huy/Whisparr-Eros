# HomeOps container

This image bundles the fork's backend and frontend. It retains the pinned Hotio Alpine container integration and replaces `/app/bin` with a self-contained `linux-musl-x64` release. No host UI overlay is needed. Built-in automatic updates are disabled; deploy a rebuilt fork image for updates.

From a clean checkout, build the UI with `yarn build --env production`. Publish `src/NzbDrone.Console/Whisparr.Console.csproj` and `src/NzbDrone.Mono/Whisparr.Mono.csproj` using .NET 10, Release, `net10.0`, `linux-musl-x64`, `--self-contained true`, `-p:Platform=Posix`, `-p:AssemblyVersion=3.6.2.1728` and `-p:AssemblyConfiguration=homeops`. Use separate output directories, then merge the Mono output into the Console output and copy `_output/UI` into its `UI/` subdirectory. That combined directory is `bin/` in the Docker build context. Copy `LICENSE.md` into `bin/` as well.

Build this Dockerfile from that context with `REVISION` set to the exact source commit and `VERSION=3.6.2.1728`. HomeOps tags the image `homenet/whisparr:<short source commit>`, retains the release archive and checksums on Nyx, and pins that tag in inventory. This tag is local to Nyx; rebuilding or loading the saved image is required on a new host. The generic Arr upgrade helper must not replace this image with an upstream release.

Before cutover, test startup and read-only APIs against a SQLite backup in a network-isolated container. Stop only Whisparr for its final configuration backup, save the installed Compose file, remove its old UI mount, and recreate only Whisparr. Rollback uses the retained image, Compose file and stopped-state configuration snapshot.

The inherited dependency versions currently produce NuGet audit advisories under warnings-as-errors. The initial deployment was published with `-p:NuGetAudit=false` as a command-line validation override; no project audit policy or package versions were changed. Review those dependencies separately when updating the fork.
