// Unit tests for bookmark validation, grouping and card sizing.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_CARD_SIZE,
	bookmarkIcon,
	bookmarkToApp,
	categoryLabel,
	effectiveCardSize,
	faviconUrl,
	groupBookmarks,
	groupPortalApps,
	normalizeUrl,
	portalCategory,
	urlHost,
	validateBookmark
} from '../src/lib/bookmarks.js';

test('normalizeUrl adds https to a bare host and keeps http(s)', () => {
	assert.equal(normalizeUrl('example.com').url, 'https://example.com/');
	assert.equal(normalizeUrl('http://example.com/x').url, 'http://example.com/x');
	assert.equal(normalizeUrl('https://example.com/x?a=1').url, 'https://example.com/x?a=1');
});

test('normalizeUrl refuses empty, junk and non-http schemes', () => {
	assert.match(normalizeUrl('').error, /required/);
	assert.match(normalizeUrl('not a url').error, /valid URL/);
	assert.match(normalizeUrl('javascript:alert(1)').error, /http/);
	assert.match(normalizeUrl('ftp://example.com').error, /http/);
});

test('validateBookmark requires a title and valid URL', () => {
	const empty = validateBookmark({});
	assert.equal(empty.ok, false);
	assert.match(empty.errors.title, /required/);
	assert.match(empty.errors.url, /required/);

	const ok = validateBookmark({ title: ' Docs ', url: 'example.com', subtitle: ' Read ', category: ' Work ' });
	assert.equal(ok.ok, true);
	assert.deepEqual(ok.value, {
		title: 'Docs',
		url: 'https://example.com/',
		subtitle: 'Read',
		category: 'Work',
		iconUrl: '',
		size: ''
	});
});

test('validateBookmark checks icon URL, lengths and card size', () => {
	const bad = validateBookmark({
		title: 'x'.repeat(121),
		url: 'https://example.com',
		subtitle: 'y'.repeat(241),
		category: 'z'.repeat(61),
		iconUrl: 'javascript:alert(1)',
		size: 'huge'
	});
	assert.equal(bad.ok, false);
	assert.ok(bad.errors.title);
	assert.ok(bad.errors.subtitle);
	assert.ok(bad.errors.category);
	assert.ok(bad.errors.iconUrl);
	assert.ok(bad.errors.size);
});

test('categoryLabel names the empty category', () => {
	assert.equal(categoryLabel(''), 'Uncategorized');
	assert.equal(categoryLabel('Media'), 'Media');
});

test('groupBookmarks follows category order, appends new ones and puts Uncategorized last', () => {
	const bookmarks = [
		{ id: 1, title: 'A', category: 'Work' },
		{ id: 2, title: 'B', category: '' },
		{ id: 3, title: 'C', category: 'Media' },
		{ id: 4, title: 'D', category: 'Later' }
	];
	const groups = groupBookmarks(bookmarks, [{ name: 'Media' }, { name: 'Work' }]);
	assert.deepEqual(groups.map((g) => g.label), ['Media', 'Work', 'Later', 'Uncategorized']);
	assert.deepEqual(groups[0].items.map((b) => b.id), [3]);
	assert.deepEqual(groups[3].items.map((b) => b.id), [2]);
});

test('groupBookmarks keeps empty user categories in edit mode data', () => {
	const groups = groupBookmarks([], [{ name: 'Empty' }, { name: 'Also empty' }]);
	assert.deepEqual(groups.map((g) => g.label), ['Empty', 'Also empty']);
});

test('portalCategory uses the first tag, then the override, then General', () => {
	assert.equal(portalCategory({ id: 'a', tags: ['media', 'companion'] }), 'media');
	assert.equal(portalCategory({ id: 'a', tags: [] }), 'General');
	assert.equal(portalCategory({ id: 'a', tags: ['media'] }, { a: 'Family' }), 'Family');
	assert.equal(portalCategory({ id: 'b', tags: [] }, { a: 'Family' }), 'General');
});

test('groupPortalApps follows the saved order and leaves General last', () => {
	const apps = [
		{ id: 'a', name: 'A', tags: ['Media'] },
		{ id: 'b', name: 'B', tags: [] },
		{ id: 'c', name: 'C', tags: ['Family'] }
	];
	const groups = groupPortalApps(apps, { order: ['Family', 'Media'] });
	assert.deepEqual(groups.map((g) => g.name), ['Family', 'Media', 'General']);
});

test('effectiveCardSize honours an item override, then the global setting', () => {
	assert.equal(effectiveCardSize('wide', 'compact'), 'wide');
	assert.equal(effectiveCardSize('', 'compact'), 'compact');
	assert.equal(effectiveCardSize('nonsense', 'nonsense'), DEFAULT_CARD_SIZE);
});

test('bookmarkIcon uses a manual icon or the favicon endpoint', () => {
	const manual = bookmarkIcon({ url: 'https://example.com', iconUrl: 'https://cdn.example.com/i.png' });
	assert.equal(manual.colored, 'https://cdn.example.com/i.png');
	const automatic = bookmarkIcon({ url: 'https://example.com', iconUrl: '' });
	assert.equal(automatic.colored, faviconUrl('https://example.com'));
});

test('bookmarkToApp gives search an app-shaped result', () => {
	const app = bookmarkToApp({ id: 7, title: 'Docs', url: 'https://docs.example.com', subtitle: 'Wiki', category: 'Work' });
	assert.equal(app.id, 'bookmark-7');
	assert.equal(app.name, 'Docs');
	assert.deepEqual(app.tags, ['Work']);
	assert.equal(urlHost('https://docs.example.com/a'), 'docs.example.com');
});
