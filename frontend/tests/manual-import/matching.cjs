// Run: node frontend/tests/manual-import/matching.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
function load(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const matching = load('frontend/src/Utilities/Import/getAutomaticSceneMatch.ts');
const match = matching.default;
assert.equal(matching.getSceneLookupTerm('ExampleSite.26.05.27.person.name.house.rules.mp4'), 'person name house rules');
assert.equal(matching.getSceneLookupTerm('arbitrary search text'), null);
const { importReducer } = load('frontend/src/AddMovie/ImportMovie/ImportMovieTypes.ts', {
  'Utilities/Import/getAutomaticSceneMatch': matching,
});
const candidate = (overrides = {}) => ({ foreignId: 'scene-one', itemType: 'scene',
  title: 'House Rules - S1:E5', studioTitle: "Example's Site", releaseDate: '2026-05-27T00:00:00Z',
  performerNames: ['Avery Moon', 'Alex Smith'], ...overrides });
const filename = 'ExamplesSite.26.05.27.avery.moon.house.rules.mp4';
const scene = candidate();
assert.equal(match(filename, [scene]), scene, 'site, title, full credited name and date');
assert.equal(match('ExamplesSite.2026.05.27.house.rules.mkv', [scene]), scene, 'title-only layout');
assert.equal(match('ExamplesSite.26.05.27.avery.moon.mp4', [scene]), scene, 'full credited name and date');
assert.equal(match('ExamplesSite.26.05.27.avery.moon.and.alex.smith.mp4', [scene]), scene, 'all named performers');
assert.equal(match('/pack/ExamplesSite.26.05.27.house.rules.mp4', [scene]), scene, 'path basename');
assert.equal(match(filename, [scene, scene]), scene, 'duplicate copies of one catalog identity');
assert.equal(match(filename, [candidate({ foreignId: 'other' }), scene]), null, 'competing catalog IDs');
assert.equal(match(filename, [candidate({ releaseDate: '2026-05-28T00:00:00Z' })]), null, 'one-day discrepancy');
assert.equal(match(filename, [candidate({ studioTitle: 'Another Site' })]), null, 'different site');
assert.equal(match(filename, [candidate({ performerNames: ['Avery Lane'] })]), null, 'credit conflict');
assert.equal(match(filename, [candidate({ performerNames: ['Avery Lit'] })]), null, 'unresolved alias');
assert.equal(match(filename, [candidate({ performerNames: [] })]), null, 'missing credit evidence');
assert.equal(match(filename, [candidate({ title: 'Different Scene' })]), null, 'title conflict');
assert.equal(match('ExamplesSite.26.05.27.avery.mp4', [scene]), null, 'first name only');
assert.equal(match('ExamplesSite.26.05.27.avery.moon.and.unknown.person.mp4', [scene]), null, 'extra uncredited performer');
assert.equal(match('ExamplesSite.26.05.27.avery.moon.house.rules.720p.mp4', [scene]), null, 'unexplained filename tokens');
assert.equal(match('ExamplesSite.26.02.30.house.rules.mp4', [candidate({ releaseDate: '2026-02-30' })]), null, 'invalid date');
assert.equal(match('ExamplesSite.26.05.27.mp4', [scene]), null, 'site and date alone');
assert.equal(match('house.rules.mp4', [scene]), null, 'unknown filename layout');
assert.equal(match(filename, []), null, 'no candidates');
assert.equal(match(filename, [candidate({ foreignId: '' })]), null, 'missing identity');
assert.equal(match(filename, [candidate({ isExcluded: true })]), null, 'import exclusion needs review');
assert.equal(match(filename, [candidate({ itemType: 'movie' })]), null, 'wrong catalog type');
const creditsOnly = candidate({ performerNames: [], searchCredits: [
  { personName: 'Avery Moon', type: 'cast' }, { personName: 'Alex Smith', type: 'crew' },
] });
assert.equal(match(filename, [creditsOnly]), creditsOnly, 'cast credits corroborate names');
assert.equal(match('ExamplesSite.26.05.27.alex.smith.mp4', [creditsOnly]), null, 'crew is not cast');
// Same site/date gives several results. Select by evidence, never by position.
const wrong = candidate({ foreignId: 'wrong', performerNames: ['Other Person'] });
assert.equal(match(filename, [wrong, scene]), scene);

let state = importReducer({ items: [], isLookingUp: false }, {
  type: 'INIT_ITEMS', files: [{ name: filename, path: '/file', relativePath: filename }],
  itemType: 'scene', defaults: { monitor: 'all', qualityProfileId: 1 },
});
const dispatch = action => { state = importReducer(state, { id: '/file', ...action }); };
dispatch({ type: 'SET_LOOKUP_RESULTS', results: [wrong] });
assert.equal(state.items[0].selectedMovie, null, 'weak candidate must not become selectedMovie');
assert.equal(state.items[0].items.length, 1, 'review candidate remains available');
dispatch({ type: 'SET_LOOKUP_RESULTS', results: [wrong, scene] });
assert.equal(state.items[0].selectedMovie.foreignId, scene.foreignId, 'unique strong choice');
dispatch({ type: 'SET_LOOKUP_ERROR', error: new Error('fixture') });
assert.equal(state.items[0].selectedMovie, null, 'failed lookups clear automatic choices');
dispatch({ type: 'SET_LOOKUP_RESULTS', results: [] });
assert.equal(state.items[0].selectedMovie, null, 'stale automatic matches are cleared');
dispatch({ type: 'SET_SELECTED_MOVIE', movie: wrong });
dispatch({ type: 'SET_LOOKUP_RESULTS', results: [scene] });
assert.equal(state.items[0].selectedMovie.foreignId, wrong.foreignId, 'explicit user choice persists');
dispatch({ type: 'SET_SELECTED_MOVIE', movie: null });
dispatch({ type: 'SET_LOOKUP_RESULTS', results: [scene] });
assert.equal(state.items[0].selectedMovie, null, 'explicit clear persists');
console.log('PASS: conservative scene evidence, ambiguity, dates, credits, partial names, stale results and explicit user choices.');
