// Unit tests for the web search engine behind the top bar: the presets in
// Configure → General, the server's search: fallback, and the URL a query is
// submitted to.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	SEARCH_ENGINES,
	serverSearchEngine,
	effectiveSearchEngine,
	buildSearchUrl
} from '../src/lib/searchEngine.js';

const SERVER = { url: 'https://www.google.com/search', param: 'q' };

test('every advertised engine has an id and a label', () => {
	assert.ok(SEARCH_ENGINES.length >= 7);
	for (const engine of SEARCH_ENGINES) {
		assert.ok(engine.id);
		assert.ok(engine.label);
	}
});

test('no pick uses the server search: entry, with a friendly name', () => {
	const engine = effectiveSearchEngine({}, SERVER);
	assert.equal(engine.url, SERVER.url);
	assert.equal(engine.param, 'q');
	assert.equal(engine.name, 'Google');
	assert.equal(engine.icon, 'si:google');
	assert.equal(engine.serverDefault, true);
});

test('a preset wins over the server default', () => {
	const engine = effectiveSearchEngine({ searchEngine: 'duckduckgo' }, SERVER);
	assert.equal(engine.id, 'duckduckgo');
	assert.equal(engine.name, 'DuckDuckGo');
	assert.equal(engine.url, 'https://duckduckgo.com/');
	assert.equal(engine.param, 'q');
});

test('Startpage uses its query parameter', () => {
	const engine = effectiveSearchEngine({ searchEngine: 'startpage' }, SERVER);
	assert.equal(engine.param, 'query');
	assert.equal(buildSearchUrl(engine, 'holm'), 'https://www.startpage.com/sp/search?query=holm');
});

test('an unknown preset falls back rather than leaving the bar blind', () => {
	const engine = effectiveSearchEngine({ searchEngine: 'nope' }, SERVER);
	assert.equal(engine.url, SERVER.url);
	assert.equal(engine.serverDefault, true);
});

test('a custom engine keeps the URL, parameter, name and icon', () => {
	const engine = effectiveSearchEngine(
		{
			searchEngine: 'custom',
			searchEngineUrl: 'https://search.example.com/search',
			searchEngineParam: 'terms',
			searchEngineName: 'Work Search',
			searchEngineIcon: 'https://search.example.com/favicon.svg'
		},
		SERVER
	);
	assert.equal(engine.id, 'custom');
	assert.equal(engine.name, 'Work Search');
	assert.equal(engine.param, 'terms');
	assert.equal(engine.icon, 'https://search.example.com/favicon.svg');
	assert.equal(engine.custom, true);
});

test('a custom engine without a URL falls back to the server default', () => {
	const engine = effectiveSearchEngine({ searchEngine: 'custom', searchEngineUrl: '  ' }, SERVER);
	assert.equal(engine.url, SERVER.url);
	assert.equal(engine.serverDefault, true);
});

test('a custom engine uses the host when no name or icon is given', () => {
	const engine = effectiveSearchEngine(
		{ searchEngine: 'custom', searchEngineUrl: 'https://searxng.example.com/search' },
		SERVER
	);
	assert.equal(engine.name, 'SearXNG');
	assert.equal(engine.param, 'q');
});

test('a server entry with no search: URL yields no engine', () => {
	assert.equal(serverSearchEngine({}), null);
	assert.equal(effectiveSearchEngine({ searchEngine: 'google' }, {}).id, 'google');
	assert.equal(effectiveSearchEngine({}, {}), null);
});

test('buildSearchUrl replaces an existing placeholder', () => {
	assert.equal(
		buildSearchUrl(serverSearchEngine({ url: 'https://www.google.com/search?q=', param: 'q' }), 'a b'),
		'https://www.google.com/search?q=a+b'
	);
});

test('buildSearchUrl encodes the query and appends the parameter', () => {
	assert.equal(
		buildSearchUrl({ url: 'https://duckduckgo.com/', param: 'q' }, 'holm & co'),
		'https://duckduckgo.com/?q=holm+%26+co'
	);
});

test('buildSearchUrl returns null without a URL', () => {
	assert.equal(buildSearchUrl(null, 'x'), null);
	assert.equal(buildSearchUrl({ url: '   ' }, 'x'), null);
});
