# Import pagination in the fork

The fork now pages import candidates in the API. Deploy its backend and frontend together. The stock 3.6.2 backend cannot serve this frontend: the earlier HomeOps read-only `/app/bin/UI` overlay is insufficient for this version. Existing HomeOps overlay archives are unchanged and still contain the earlier frontend-only implementation.

No database migration is required. Existing unpaged endpoints remain available for other API clients.

## API

- `GET /api/v3/manualimport/paged?folder=...&page=1&pageSize=50&sortKey=relativePath&sortDirection=ascending`
- `GET /api/v3/rootFolder/{id}/importfiles?page=1&pageSize=50&sortKey=relativePath&sortDirection=ascending`

Both responses contain `page`, `pageSize`, `sortKey`, `sortDirection`, `totalRecords`, and `records`. Pages start at 1. The default page size is 50; requests outside 1–200, invalid pages, and unsupported sorting return HTTP 400. Pages beyond the end return an empty `records` array with the correct total. A missing root-folder ID returns the existing not-found error.

The root-folder endpoint uses database filtering, ordering, count, limit and offset. It scopes results to the requested root folder and uses the record ID to break sort ties. It supports `relativePath`, `name` and `path` sorting.

Manual Import enumerates file paths to establish the count and global order, then analyzes only the requested page. Directory and tracked-download context, existing-file filtering, and movie-folder import decisions are retained. Matched folders batch the page's analysis while retaining folder-wide sample context; sample counting stops once it establishes that multiple non-sample files exist. Library-file metadata mapping is also deferred until the requested page. The old unknown-folder file cutoff does not apply to the paged endpoint.

Manual Import supports global path and file-size sorting. Path order is ordinal, case insensitive, with the full path breaking ties. Size sorting needs file-size reads for all candidates. Metadata-column sort controls are disabled because ordering by computed match/quality metadata would require analyzing the full folder first. Filesystem enumeration still covers the folder; pagination bounds analysis and response size, not enumeration. Paths are enumerated afresh per request, so concurrent filesystem changes can change page membership.

`GET /rootFolder`, `GET /rootFolder/{id}`, and `POST /rootFolder/refresh/{id}` accept `includeImportFiles=false`. This returns `importFileCount` without embedding the entire file list. The UI uses these summaries for folder lists and imports. The default remains `true` for existing clients.

## UI behavior

Each page requests 50 candidates. Catalog lookups run only for the visible library-import page, and navigation cancels its outstanding lookups. Visited pages retain matches, per-file settings, explicit choices and deselections. Auto-selection is limited to fetched/analyzed pages; unseen files are never silently selected.

Header selection and shift selection affect the current page. Import, bulk edits and delete validation include selected records from all visited pages. Changing the folder or existing-file filter clears the manual-import state. Changing sort order preserves choices and returns to page one. Library imports retain the deterministic site/date/title/credit matching and bounded fallback search; no LLM calls are used.

After a successful library batch, the page removes only the submitted paths, waits for the root-folder rescan, and refetches the active page before leaving the busy state. The count and page number are reconciled with the refreshed response; an emptied last page moves to the new last page. Submitted paths cannot reappear from stale responses while the rescan is pending. Remaining reviewed rows retain their settings and deselections. A rescan failure is shown separately from an import failure, with a Refresh action that retries only the rescan.

## Validation

Backend coverage includes paging validation and resource mapping, actual SQL pagination/root scoping, folder summaries without full file queries, bounded Manual Import analysis beyond the old cutoff, global ordering and size sort, duplicate basenames, empty/missing paths and existing-file filtering before paging. Existing root-folder and import-decision tests are included in the targeted run.

The isolated browser fixture intercepts every API request and mutation. It uses 10,001 Manual Import files and 1,001 library-import files, checking bounded page responses, navigation, cached lookup results, persistent deselection, cross-page edited submissions, hidden invalid selections, sorting/filter resets, conservative scene selection and files beyond 500. The post-import regression submits synthetic batches across pages, delays the rescan while navigating, verifies automatic page refill/count updates and last-page clamping, and retries an intercepted rescan failure without repeating the import. No test imports or deletes live media.

```sh
dotnet test src/NzbDrone.Api.Test/Whisparr.Api.Test.csproj \
  --filter 'FullyQualifiedName~ImportPaging|FullyQualifiedName~ManualImportPaging'
dotnet test src/NzbDrone.Core.Test/Whisparr.Core.Test.csproj \
  --filter 'FullyQualifiedName~ManualImportPaging|FullyQualifiedName~ImportFilePaging|FullyQualifiedName~RootFolderServiceFixture|FullyQualifiedName~ImportDecisionMakerFixture'
yarn webpack --config frontend/tests/manual-import/webpack.cjs
NODE_PATH=/path/to/playwright/node_modules node frontend/tests/manual-import/browser.cjs
node frontend/tests/manual-import/matching.cjs
yarn build --env production
```

Local validation used a temporary .NET 10 SDK. Existing dependency security advisories made the default restore fail under warnings-as-errors; targeted validation used `-p:NuGetAudit=false` for that invocation only. No dependency versions or repository audit settings were changed. Dependency remediation remains separate from this feature.
