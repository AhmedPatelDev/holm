// Unit tests for src/lib/adminConfig.js, the validation shared by the Config
// tab and the server's pre-save check.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	appItemLineIndexes,
	configToYaml,
	flattenApps,
	isLegacyApps,
	parseConfigText,
	slugifyId,
	uniqueAppId,
	validateConfigObject
} from '../src/lib/adminConfig.js';

test('slugifyId makes a stable id and uniqueAppId avoids collisions', () => {
	assert.equal(slugifyId('Jellyfin Media Server!'), 'jellyfin-media-server');
	assert.equal(slugifyId('  Ünïcödé App  '), 'unicode-app');
	assert.equal(slugifyId("Bob's Photos"), 'bobs-photos');
	assert.equal(slugifyId('***'), '');
	assert.equal(uniqueAppId('Photos', []), 'photos');
	assert.equal(uniqueAppId('Photos', ['photos']), 'photos-2');
	assert.equal(uniqueAppId('Photos', ['photos', 'photos-2']), 'photos-3');
	assert.equal(uniqueAppId('***', []), 'app');
});

test('a valid flat config passes', () => {
	const text = `apps:
  - id: jellyfin
    name: Jellyfin
    url: "https://jellyfin.example.com"
    icon: "di:jellyfin"
    tags: [media]
    groups: [family]
    service: true
search:
  url: "https://www.google.com/search"
  param: q
`;
	const result = parseConfigText(text);
	assert.equal(result.ok, true);
	assert.deepEqual(result.errors, []);
	assert.equal(result.config.apps[0].id, 'jellyfin');
});

test('missing id, name or url is reported, with a line for url', () => {
	const text = `apps:
  - id: jellyfin
    name: Jellyfin
  - id: photos
    url: "https://photos.example.com"
`;
	const result = parseConfigText(text);
	assert.equal(result.ok, false);
	const messages = result.errors.map((err) => err.message).join('\n');
	assert.match(messages, /apps\.jellyfin: url is required/);
	assert.match(messages, /apps\.photos: name is required/);
	const urlError = result.errors.find((err) => err.message.includes('url is required'));
	assert.equal(urlError.line, 2);
});

test('duplicate app ids are rejected', () => {
	const result = parseConfigText(`apps:
  - id: photos
    name: Photos
    url: "https://a.example.com"
  - id: photos
    name: Photos again
    url: "https://b.example.com"
`);
	assert.equal(result.ok, false);
	assert.match(result.errors.map((err) => err.message).join('\n'), /id is used by more than one app/);
});

test('a YAML indentation error carries its line number', () => {
	const result = parseConfigText(`apps:
  - id: photos
   name: Photos
    url: "https://photos.example.com"
`);
	assert.equal(result.ok, false);
	assert.equal(typeof result.errors[0].line, 'number');
	assert.ok(result.errors[0].line >= 2);
});

test('wrong field types are rejected', () => {
	const result = parseConfigText(`apps:
  - id: photos
    name: Photos
    url: "https://photos.example.com"
    tags: media
    service: "yes"
    app_store: nope
search:
  url: 42
`);
	assert.equal(result.ok, false);
	const messages = result.errors.map((err) => err.message).join('\n');
	assert.match(messages, /tags must be a list of strings/);
	assert.match(messages, /service must be true or false/);
	assert.match(messages, /app_store must be a mapping/);
	assert.match(messages, /search\.url must be text/);
});

test('the legacy category/items shape is accepted and can be flattened', () => {
	const apps = [{ category: 'Media', items: [{ id: 'photos', name: 'Photos', url: 'https://a.example.com' }] }];
	assert.equal(isLegacyApps(apps), true);
	assert.deepEqual(flattenApps(apps), apps[0].items);
	const result = parseConfigText(`apps:
  - category: Media
    items:
      - id: photos
        name: Photos
        url: "https://photos.example.com"
`);
	assert.equal(result.ok, true);
	assert.equal(result.config.apps[0].items[0].id, 'photos');
});

test('app item lines are found without mistaking setup_guide steps for apps', () => {
	const text = `apps:
  - id: photos
    name: Photos
    url: "https://photos.example.com"
    setup_guide:
      steps:
        - label: Download
          desc: Get the app.
  - id: cloud
    name: Cloud
    url: "https://cloud.example.com"
`;
	assert.deepEqual(appItemLineIndexes(text), [1, 8]);
});

test('validating an object without raw text still reports the problem', () => {
	const errors = validateConfigObject({ apps: [{ id: 'a', name: 'A' }] });
	assert.equal(errors.length, 1);
	assert.match(errors[0].message, /url is required/);
	assert.equal(errors[0].line, undefined);
});

test('serializing preserves unknown app and top-level fields', () => {
	const config = {
		branding: { name: 'Home' },
		apps: [
			{
				id: 'photos',
				name: 'Photos',
				url: 'https://photos.example.com',
				health: { url: 'https://photos.example.com/ping', every: '5m' },
				on_click: 'menu',
				custom_future_field: 'keep me'
			}
		],
		search: { url: 'https://search.example.com', param: 'q' }
	};
	const text = configToYaml(config);
	const result = parseConfigText(text);
	assert.equal(result.ok, true);
	assert.equal(result.config.apps[0].health.every, '5m');
	assert.equal(result.config.apps[0].on_click, 'menu');
	assert.equal(result.config.apps[0].custom_future_field, 'keep me');
	assert.equal(result.config.branding.name, 'Home');
});

test('empty or non-mapping files are rejected clearly', () => {
	assert.equal(parseConfigText('').ok, false);
	assert.equal(parseConfigText('   \n').ok, false);
	const list = parseConfigText('- one\n- two\n');
	assert.equal(list.ok, false);
	assert.match(list.errors[0].message, /mapping of settings/);
});
