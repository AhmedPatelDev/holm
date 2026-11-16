// Unit tests for apps[].on_click, what a plain click on a tile does.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAppsFromConfig, clickAction, clickActionWarnings } from '../src/lib/apps.js';

const guide = { steps: [{ label: 'Download', desc: 'Get the app.' }] };
const stores = { ios: 'https://apps.apple.com/app/x', android: 'https://play.google.com/x' };

test('service and description map from config with clean defaults', () => {
	const { apps } = buildAppsFromConfig([
		{ id: 'backup', name: 'Backup', url: 'https://backup.example.com', icon: 'di:proxmox', service: true, description: '  Nightly snapshots  ' },
		{ id: 'photos', name: 'Photos', url: 'https://photos.example.com', icon: 'di:immich', service: 'yes', description: 42 },
		{ id: 'plain', name: 'Plain', url: 'https://plain.example.com', icon: 'di:example' }
	]);
	assert.equal(apps[0].service, true);
	assert.equal(apps[0].description, 'Nightly snapshots');
	// Only a real boolean marks a service; other values stay false.
	assert.equal(apps[1].service, false);
	assert.equal(apps[1].description, '');
	assert.equal(apps[2].service, false);
	assert.equal(apps[2].description, '');
});

test('unset or open opens the app', () => {
	assert.equal(clickAction({ id: 'a' }), 'open');
	assert.equal(clickAction({ id: 'a', on_click: 'open', setup_guide: guide }), 'open');
});

test('getting_started needs a setup guide or store links', () => {
	assert.equal(clickAction({ id: 'a', on_click: 'getting_started', setup_guide: guide }), 'getting_started');
	assert.equal(clickAction({ id: 'a', on_click: 'getting_started', app_store: stores }), 'getting_started');
	assert.equal(clickAction({ id: 'a', on_click: 'getting_started' }), 'open');
	assert.equal(clickAction({ id: 'a', on_click: 'getting_started', app_store: {} }), 'open');
});

test('menu opens the tile menu, with or without a guide', () => {
	assert.equal(clickAction({ id: 'a', on_click: 'menu' }), 'menu');
});

test('an unknown value opens the app', () => {
	assert.equal(clickAction({ id: 'a', on_click: 'guide', setup_guide: guide }), 'open');
	assert.equal(clickAction({ id: 'a', on_click: true, setup_guide: guide }), 'open');
});

test('store links alone give a Getting started card with no steps', () => {
	const { apps, setupGuides } = buildAppsFromConfig([
		{ id: 'a', name: 'A', url: 'https://a.example.com', on_click: 'getting_started', app_store: stores },
		{ id: 'b', name: 'B', url: 'https://b.example.com', app_store: stores }
	]);
	assert.deepEqual(setupGuides.A.steps, []);
	assert.equal(setupGuides.B, undefined);
	assert.deepEqual(apps.map((a) => a.onClick), ['getting_started', 'open']);
});

test('the startup check names unknown values and a getting_started with nothing to show', () => {
	const warnings = clickActionWarnings([
		{ id: 'ok', on_click: 'getting_started', setup_guide: guide },
		{ id: 'plain' },
		{ id: 'typo', on_click: 'guide' },
		{ id: 'empty', on_click: 'getting_started' }
	]);
	assert.equal(warnings.length, 2);
	assert.match(warnings[0], /apps\.typo\.on_click "guide" is not one of open, getting_started, menu/);
	assert.match(warnings[1], /apps\.empty\.on_click is getting_started but the app has no setup_guide/);
});
