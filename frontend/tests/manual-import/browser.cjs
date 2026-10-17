// Build: yarn webpack --config frontend/tests/manual-import/webpack.cjs
// Run with NODE_PATH pointing to Playwright. All API calls are intercepted fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const output = path.resolve(__dirname, '../../../_output/manual-import-test');
const quality = { quality: { id: 1, name: 'SD', source: 'television', resolution: 480 }, revision: { version: 1, real: 0, isRepack: false } };
const makeItem = id => ({ id, path: `/fixture/file-${id}.mkv`, relativePath: `file-${String(id).padStart(5, '0')}.mkv`,
  folderName: 'fixture', name: `file-${id}`, size: 1024, quality, qualityWeight: 1,
  languages: [{ id: 1, name: 'English' }], movie: { id, title: `Fixture ${id}`, sortTitle: `fixture ${id}` },
  releaseGroup: 'Fixture', customFormats: [], customFormatScore: 0, indexerFlags: 0, rejections: [], movieFileId: id });
const items = Array.from({ length: 10001 }, (_, i) => makeItem(i + 1));
const sceneItems = Array.from({ length: 6 }, (_, i) => ({ ...makeItem(i + 1),
  path: `/fixture/FixtureSite.26.01.01.person.name.Scene${i + 1}.mkv`,
  relativePath: `FixtureSite.26.01.01.person.name.Scene${i + 1}.mkv`,
  movie: { id: i + 1, foreignId: `scene-${i + 1}`, itemType: 'scene',
    title: `Scene${i + 1}`, sortTitle: `scene${i + 1}`, studioTitle: 'Fixture Site',
    releaseDate: '2026-01-01T00:00:00Z', performerNames: ['Person Name'] },
}));
sceneItems[1].movie.performerNames = ['Another Person'];
sceneItems[2].movie.releaseDate = '2026-01-02T00:00:00Z';
sceneItems[3].movie.studioTitle = 'Another Site';
sceneItems[4].movie = undefined;
sceneItems[4].movieFileId = undefined;
sceneItems[5].rejections = [{ reason: 'Needs review' }];
// One invalid, unselected row on the final page.
items[10000].movie = undefined;
items[10000].movieFileId = undefined;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    const writes = [];
    let scenePhase = false;
    const pageRequests = [];
    const libraryRequests = [];
    const lookupRequests = [];
    let refreshGate = null;
    let failNextRefresh = false;
    let pendingImportPaths = new Set();
    const libraryFiles = Array.from({ length: 1001 }, (_, i) => ({
      name: `FixtureSite.26.01.01.Scene${String(i + 1).padStart(4, '0')}.mkv`,
      path: `/library/${i + 1}/same.mkv`, relativePath: `${String(i + 1).padStart(4, '0')}/same.mkv`,
    }));
    const rootSummary = { id: 1, path: '/library', accessible: true, importFileCount: 1001 };

    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE', error.stack); });
    await page.addInitScript(() => { window.Whisparr = { urlBase: '', apiKey: 'fixture', isProduction: true }; });
    await page.route('http://whisparr.test/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) {
        if (req.method() !== 'GET') {
          writes.push({ path: url.pathname, body: req.postDataJSON() });
          const body = req.postDataJSON();
          if (url.pathname === '/api/v3/movie/import') {
            pendingImportPaths = new Set(body.map(item => item.path));
            return route.fulfill({ json: [] });
          }
          if (url.pathname.includes('/rootFolder/refresh/')) {
            if (refreshGate) await refreshGate;
            if (failNextRefresh) {
              failNextRefresh = false;
              return route.fulfill({ status: 500, json: { message: 'Fixture refresh failed' } });
            }
            for (let i = libraryFiles.length - 1; i >= 0; i--) {
              if (pendingImportPaths.has(libraryFiles[i].path)) libraryFiles.splice(i, 1);
            }
            pendingImportPaths.clear();
            rootSummary.importFileCount = libraryFiles.length;
            return route.fulfill({ json: rootSummary });
          }
          return route.fulfill({ json: url.pathname.endsWith('/manualimport') ? body.map(item => {
            const result = { ...(scenePhase ? sceneItems : items)[item.id - 1], ...item };
            if (scenePhase && item.releaseGroup === 'ConflictFixture') result.rejections = [{ reason: 'Needs review' }];
            return result;
          }) : {} });
        }
        assert.notEqual(url.pathname, '/api/v3/manualimport', 'the UI must never request the unpaged list');
        let data = [];
        if (url.pathname === '/api/v3/rootFolder/1') {
          assert.equal(url.searchParams.get('includeImportFiles'), 'false');
          data = rootSummary;
        } else if (url.pathname === '/api/v3/qualityprofile') {
          data = [{ id: 1, name: 'Any', items: [] }];
        } else if (url.pathname === '/api/v3/rootFolder/1/importfiles') {
          const pageNumber = Number(url.searchParams.get('page'));
          const pageSize = Number(url.searchParams.get('pageSize'));
          const source = url.searchParams.get('sortDirection') === 'descending' ? [...libraryFiles].reverse() : libraryFiles;
          data = { page: pageNumber, pageSize, totalRecords: source.length,
            records: source.slice((pageNumber - 1) * pageSize, pageNumber * pageSize) };
          libraryRequests.push({ page: pageNumber, count: data.records.length });
        } else if (url.pathname === '/api/v3/movie/lookup') {
          const term = url.searchParams.get('term');
          lookupRequests.push(term);
          const title = term.match(/Scene\d+/)?.[0];
          data = title ? [{ foreignId: title, title, itemType: 'scene', studioTitle: 'Fixture Site', releaseDate: '2026-01-01T00:00:00Z',
            isExisting: false, year: 2026, tmdbId: 0, searchCredits: [] }] : [];
        }

        if (url.pathname.endsWith('/manualimport/paged')) {
          const pageNumber = Number(url.searchParams.get('page'));
          const pageSize = Number(url.searchParams.get('pageSize'));
          const source = [...(scenePhase ? sceneItems : url.searchParams.get('filterExistingFiles') === 'true' ? items.slice(0, 3) : items)];
          if (url.searchParams.get('sortDirection') === 'descending') source.reverse();
          data = { page: pageNumber, pageSize, totalRecords: source.length,
            records: source.slice((pageNumber - 1) * pageSize, pageNumber * pageSize) };
          pageRequests.push({ page: pageNumber, count: data.records.length });
        }
        return route.fulfill({ json: data });
      }
      if (url.pathname === '/' || url.pathname.startsWith('/add/')) {
        return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(output, 'index.html'), 'utf8').replaceAll('__URL_BASE__', '').replace("urlBase: ''", "urlBase: '', apiRoot: '/api/v3', apiKey: 'fixture', theme: 'light'") });
      }
      const file = path.join(output, url.pathname);
      if (!fs.existsSync(file)) return route.fulfill({ status: 204, body: '' });
      return route.fulfill({ path: file });
    });
    await page.goto('http://whisparr.test/');
    const rows = page.locator('tbody tr');
    try { await rows.first().waitFor(); } catch (e) { console.error((await page.locator('body').innerText()).slice(0, 2000)); throw e; }
    await page.waitForFunction(() => document.body.textContent.includes('Import (50)'));
    assert.equal(await rows.count(), 50);
    assert.match(await page.locator('body').innerText(), /1 \/ 201/);
    assert.deepEqual(pageRequests, [{ page: 1, count: 50 }]);
    const first = page.getByRole('button', { name: 'Go to first page', exact: true });
    const next = page.getByRole('button', { name: 'Go to next page', exact: true });
    const last = page.getByRole('button', { name: 'Go to last page', exact: true });
    const selectRow = (index, options) => rows.nth(index).locator('label').first().click(options);
    const importButton = page.getByRole('button', { name: /^Import \(/ });
    const waitRow = name => page.waitForFunction(name => document.querySelector('tbody tr')?.textContent.includes(name), name);
    await selectRow(0);
    await next.click();
    await waitRow('file-00051');
    await page.waitForFunction(() => document.body.textContent.includes('Import (99)'));
    await selectRow(0, { modifiers: ['Shift'] });
    await first.click();
    await waitRow('file-00001');
    assert.equal(await rows.first().locator('input[type=checkbox]').isChecked(), false);
    await last.click();
    await waitRow('file-10001');
    assert.equal(await rows.count(), 1);
    await selectRow(0);
    assert.equal(await importButton.isDisabled(), true);
    await first.click();
    await waitRow('file-00001');
    assert.equal(await importButton.isDisabled(), true, 'invalid off-page selections still block import');
    assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true);
    await last.click();
    await waitRow('file-10001');
    await selectRow(0);
    await page.getByText('Relative Path', { exact: true }).click();
    await waitRow('file-10001');
    assert.match(await page.locator('body').innerText(), /1 \/ 201/);
    await page.locator('[class*="filterContainer"] button').click();
    await page.getByText('Unmapped Files Only', { exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
    await page.waitForFunction(() => document.body.textContent.includes('Import (3)'));
    assert.match(await page.locator('body').innerText(), /1 \/ 1/);
    assert.deepEqual(writes, []);
    await rows.first().getByText('Fixture', { exact: true }).click();
    await page.locator('input[name="releaseGroup"]').fill('EditedFixture');
    await page.getByRole('button', { name: 'Set Release Group', exact: true }).click();
    await waitRow('EditedFixture');
    await page.locator('select[name="importMode"]').selectOption('copy');
    await importButton.click();
    await page.waitForFunction(() => document.title === 'closed');
    const update = writes.find(write => write.path === '/api/v3/moviefile/bulk');
    assert.deepEqual(update.body.map(item => item.id).sort(), [1, 2, 3]);
    assert.equal(update.body.find(item => item.id === 3).releaseGroup, 'EditedFixture');
    assert(pageRequests.every(request => request.count <= 50));
    // Explicitly submit selections from two pages, including an edit made on the hidden page.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitRow('file-00001');
    await page.waitForFunction(() => document.body.textContent.includes('Import (50)'));
    await page.locator('thead label').first().click();
    await selectRow(0);
    await rows.first().getByText('Fixture', { exact: true }).click();
    await page.locator('input[name="releaseGroup"]').fill('CrossPageEdit');
    await page.getByRole('button', { name: 'Set Release Group', exact: true }).click();
    await waitRow('CrossPageEdit');
    await next.click();
    await waitRow('file-00051');
    await page.waitForFunction(() => document.body.textContent.includes('Import (51)'));
    await page.locator('thead label').first().click();
    await selectRow(0);
    await page.locator('select[name="importMode"]').selectOption('copy');
    await importButton.click();
    await page.waitForFunction(() => document.title === 'closed');
    const crossPageUpdate = writes.filter(write => write.path === '/api/v3/moviefile/bulk').at(-1);
    assert.deepEqual(crossPageUpdate.body.map(item => item.id).sort((a, b) => a - b), [1, 51]);
    assert.equal(crossPageUpdate.body.find(item => item.id === 1).releaseGroup, 'CrossPageEdit');
    scenePhase = true;
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    try {
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 6);
    } catch (error) {
      console.error('Scene fixture state:', (await page.locator('body').textContent()).slice(0, 3500), errors);
      throw error;
    }
    await page.waitForFunction(() => document.body.textContent.includes('Import (1)'));
    for (let i = 0; i < 6; i++) {
      assert.equal(await rows.nth(i).locator('input[type=checkbox]').first().isChecked(), i === 0,
        'only the clear scene match should be selected, including rejected and unmapped rows');
    }
    // Editing release settings is not confirmation of a weak scene match.
    await rows.nth(1).getByText('Fixture', { exact: true }).click();
    await page.locator('input[name="releaseGroup"]').fill('ReviewedSetting');
    await page.getByRole('button', { name: 'Set Release Group', exact: true }).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('tbody tr'))[1].textContent.includes('ReviewedSetting'));
    assert.equal(await rows.nth(1).locator('input[type=checkbox]').first().isChecked(), false);
    await selectRow(1);
    assert.equal(await rows.nth(1).locator('input[type=checkbox]').first().isChecked(), true, 'explicit manual selection remains available');
    await rows.first().getByText('Fixture', { exact: true }).click();
    await page.locator('input[name="releaseGroup"]').fill('ConflictFixture');
    await page.getByRole('button', { name: 'Set Release Group', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('tbody tr')?.textContent.includes('ConflictFixture'));
    await page.waitForFunction(() => !document.querySelector('tbody tr input[type=checkbox]')?.checked);
    assert.equal(await rows.nth(1).locator('input[type=checkbox]').first().isChecked(), true,
      'new rejections clear automatic selection while preserving explicit user choices');
    assert.deepEqual(errors, []);
    await page.goto('http://whisparr.test/add/import/scenes/1');
    try {
      await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"]').length === 50);
    } catch (error) {
      console.error('Library page:', (await page.locator('body').innerText()).slice(0, 5000), libraryRequests, lookupRequests.length, errors);
      throw error;
    }
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"] input[type=checkbox]:checked').length === 50);
    assert.deepEqual(libraryRequests, [{ page: 1, count: 50 }]);
    assert.equal(lookupRequests.length, 50);
    await page.locator('[class*="ImportMovieTable-row"]').first().locator('label').click();
    await next.click();
    await page.waitForFunction(() => document.querySelector('[class*="ImportMovieTable-row"]')?.textContent.includes('0051/same.mkv'));
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"] input[type=checkbox]:checked').length === 50);
    assert.equal(lookupRequests.length, 100);
    await first.click();
    await page.waitForFunction(() => document.querySelector('[class*="ImportMovieTable-row"]')?.textContent.includes('0001/same.mkv'));
    assert.equal(await page.locator('[class*="ImportMovieTable-row"]').first().locator('input[type=checkbox]').isChecked(), false);
    assert.equal(lookupRequests.length, 100, 'cached page lookup results must survive paging');
    await last.click();
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"]').length === 1);
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"] input[type=checkbox]:checked').length === 1);
    assert.equal(lookupRequests.length, 101, 'unvisited pages must never trigger catalog lookups');
    assert(libraryRequests.every(request => request.count <= 50));
    assert(libraryRequests.some(request => request.page === 21));
    assert.deepEqual(errors, []);
    // A successful import must wait for the rescan, refresh counts, and clamp an emptied last page.
    const libraryRows = page.locator('[class*="ImportMovieTable-row"]');
    const batchButton = page.locator('button[class*="ImportMovieFooter-importButton"]');
    const batchWrites = () => writes.filter(write => write.path === '/api/v3/movie/import');
    let releaseRefresh;
    refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
    let refreshRequest = page.waitForRequest(request => request.url().includes('/rootFolder/refresh/'));
    await batchButton.click();
    await refreshRequest;
    await page.waitForFunction(() => document.body.textContent.includes('Import 0 File'));
    assert.match(await batchButton.getAttribute('class'), /isSpinning/, 'import stays busy until folder refresh completes');
    assert.equal(batchWrites().length, 1);
    assert.equal(batchWrites()[0].body.length, 100, 'all selected paths across visited pages are submitted');
    assert(!batchWrites()[0].body.some(item => item.path === '/library/1/same.mkv'));
    releaseRefresh();
    refreshGate = null;
    await page.waitForFunction(() => document.body.textContent.includes('Total records: 901') && document.body.textContent.includes('19 / 19'));
    await page.waitForFunction(() => document.querySelector('[class*="ImportMovieTable-row"]')?.textContent.includes('1000/same.mkv'));
    assert.equal(await libraryRows.count(), 1);
    assert.equal(batchWrites().length, 1, 'clamping must not resubmit the batch');
    // Refill page one automatically and retain the earlier deselection.
    await first.click();
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"]').length === 50);
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"] input[type=checkbox]:checked').length === 49);
    assert.equal(await libraryRows.first().locator('input[type=checkbox]').isChecked(), false);
    assert.match(await libraryRows.nth(1).innerText(), /0101\/same.mkv/);
    // Navigate while the rescan is pending: stale pages must not resurrect submitted files.
    refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
    refreshRequest = page.waitForRequest(request => request.url().includes('/rootFolder/refresh/'));
    await batchButton.click();
    await refreshRequest;
    await next.click();
    await page.waitForFunction(() => document.querySelector('[class*="ImportMovieTable-row"]')?.textContent.includes('0150/same.mkv'));
    await first.click();
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"]').length === 1);
    assert.match(await libraryRows.first().innerText(), /0001\/same.mkv/);
    releaseRefresh();
    refreshGate = null;
    await page.waitForFunction(() => document.body.textContent.includes('Total records: 851'));
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"]').length === 50);
    assert.equal(await libraryRows.first().locator('input[type=checkbox]').isChecked(), false);
    assert.match(await libraryRows.nth(1).innerText(), /0150\/same.mkv/);
    // Refresh failures are separate from import failures; retry only the rescan.
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"] input[type=checkbox]:checked').length === 49);
    failNextRefresh = true;
    await batchButton.click();
    await page.getByText(/The batch was imported, but the file list could not be refreshed/).waitFor();
    assert.equal(batchWrites().length, 3);
    assert.equal(await batchButton.count(), 0, 'another batch waits for a successful refresh');
    const expectedTotal = libraryFiles.length - batchWrites().at(-1).body.length;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(total => document.body.textContent.includes(`Total records: ${total}`), expectedTotal);
    await page.waitForFunction(() => document.querySelectorAll('[class*="ImportMovieTable-row"]').length === 50);
    assert.equal(batchWrites().length, 3, 'refresh retry never repeats a successful import');
    assert.equal(await libraryRows.first().locator('input[type=checkbox]').isChecked(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: batch imports rescan and refill without reload; counts/page clamping, pending-refresh navigation, preserved deselection and refresh-only retry.');
    console.log('PASS: library import fetches only requested pages, retains lookup results and deselections, handles duplicate basenames and files beyond 500.');
    console.log('PASS: only clear scene evidence auto-selects; credit/site/date conflicts, rejections and missing matches stay unchecked; setting edits do not approve review rows; explicit selection works.');
    console.log('PASS: server pagination over 10,001 files, bounded responses, navigation, persistent deselection, off-page validation/deletion, sorting, filter reset, edits and complete submission payload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
