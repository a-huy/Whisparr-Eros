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
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE', error.stack); });
    await page.addInitScript(() => { window.Whisparr = { urlBase: '', apiKey: 'fixture', isProduction: true }; });
    await page.route('http://whisparr.test/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) {
        if (req.method() !== 'GET') {
          writes.push({ path: url.pathname, body: req.postDataJSON() });
          const body = req.postDataJSON();
          return route.fulfill({ json: url.pathname.endsWith('/manualimport') ? body.map(item => ({ ...items[item.id - 1], ...item })) : {} });
        }
        const data = url.pathname.endsWith('/manualimport')
          ? (url.searchParams.get('filterExistingFiles') === 'true' ? items.slice(0, 3) : items)
          : [];
        return route.fulfill({ json: data });
      }
      if (url.pathname === '/') {
        return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(output, 'index.html'), 'utf8').replaceAll('__URL_BASE__', '').replace("urlBase: ''", "urlBase: '', apiRoot: '/api/v3', apiKey: 'fixture'") });
      }
      const file = path.join(output, url.pathname);
      if (!fs.existsSync(file)) return route.fulfill({ status: 204, body: '' });
      return route.fulfill({ path: file });
    });
    await page.goto('http://whisparr.test/');
    const rows = page.locator('tbody tr');
    try { await rows.first().waitFor(); } catch (e) { console.error((await page.locator('body').innerText()).slice(0, 2000)); throw e; }
    await page.waitForFunction(() => document.body.textContent.includes('Import (10000)'));
    assert.equal(await rows.count(), 50);
    assert.match(await page.locator('body').innerText(), /1 \/ 201/);
    await page.screenshot({ path: path.join(output, 'pagination-10001.png') });
    const first = page.getByRole('button', { name: 'Go to first page', exact: true });
    const next = page.getByRole('button', { name: 'Go to next page', exact: true });
    const last = page.getByRole('button', { name: 'Go to last page', exact: true });
    const selectRow = (index, options) => rows.nth(index).locator('label').first().click(options);
    const importButton = page.getByRole('button', { name: /^Import \(/ });
    await selectRow(0);
    assert.match(await importButton.innerText(), /9999/);
    await next.click(); // Next
    assert.match(await rows.first().innerText(), /file-00051/);
    assert.equal(await rows.count(), 50);
    await selectRow(0, { modifiers: ['Shift'] });
    await first.click(); // First
    assert.equal(await rows.first().locator('input[type=checkbox]').isChecked(), false);
    // Header acts on the current page only.
    await page.locator('thead label').first().click();
    assert.match(await importButton.innerText(), /9999/);
    // Explicitly clear this page, preserving other pages.
    if (await rows.first().locator('input').isChecked()) await page.locator('thead label').first().click();
    await page.waitForFunction(() => document.body.textContent.includes('Import (9949)'));
    await last.click(); // Last
    assert.equal(await rows.count(), 1);
    assert.match(await rows.first().innerText(), /file-10001/);
    await selectRow(0);
    assert.equal(await importButton.isDisabled(), true);
    await first.click();
    assert.equal(await importButton.isDisabled(), true, 'invalid selection must stay invalid off-page');
    assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true);
    await last.click();
    await selectRow(0);
    assert.equal(await importButton.isDisabled(), false);
    // Sorting resets to page one; deselection follows IDs.
    await page.getByText('Relative Path', { exact: true }).click();
    assert.match(await page.locator('body').innerText(), /1 \/ 201/);
    await page.waitForFunction(() => document.querySelector('tbody tr')?.textContent.includes('file-10001'));
    // Changing the filter clamps the page and resets data-specific state.
    await last.click();
    await page.locator('[class*="filterContainer"] button').click();
    await page.getByText('Unmapped Files Only', { exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
    assert.match(await page.locator('body').innerText(), /1 \/ 1/);
    assert.match(await importButton.innerText(), /3/);
    await page.screenshot({ path: path.join(output, 'pagination.png') });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, [], 'navigation and selection must not import or delete files');
    // Edit a row, leave its page, and submit all selected records. Writes are
    // captured above and never reach a Whisparr instance.
    await rows.first().getByText('Fixture', { exact: true }).click();
    await page.locator('input[name="releaseGroup"]').fill('EditedFixture');
    await page.getByRole('button', { name: 'Set Release Group', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('tbody tr')?.textContent.includes('EditedFixture'));
    await page.locator('select[name="importMode"]').selectOption('copy');
    await importButton.click();
    await page.waitForFunction(() => document.title === 'closed');
    const update = writes.find(write => write.path === '/api/v3/moviefile/bulk');
    assert.deepEqual(update.body.map(item => item.id).sort(), [1, 2, 3]);
    assert.equal(update.body.find(item => item.id === 3).releaseGroup, 'EditedFixture');
    console.log('PASS: 10,001 files, 50 rows/page, navigation, persistent deselection, page selection, off-page validation/deletion guard, sorting and filter reset. Edits and full selection payload verified with intercepted writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
