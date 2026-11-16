// Shared config.yml helpers: slugify, YAML parsing and schema checks.
//
// Deliberately free of server imports so the same code runs in the browser
// (live validation in the raw editor) and on the server (pre-save checks).
// The server still repeats its richer setting validators after this passes.

import yaml from 'js-yaml';

const isMapping = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string';

/** Turn a display name into a stable app id: "My App!" → "my-app". */
export function slugifyId(name) {
	return String(name ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

/** Slugify a name and add -2, -3… until it isn't already used. */
export function uniqueAppId(name, existingIds = []) {
	const base = slugifyId(name) || 'app';
	const used = new Set(existingIds);
	if (!used.has(base)) return base;
	for (let n = 2; n < 10000; n++) {
		const candidate = `${base}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
	return `${base}-${Date.now()}`;
}

export function isLegacyApps(apps) {
	return Array.isArray(apps) && apps.length > 0 && Array.isArray(apps[0]?.items);
}

/** Legacy `[{category, items}]` → flat `[{id, ...}]`; anything else as-is. */
export function flattenApps(apps) {
	if (!Array.isArray(apps)) return [];
	return isLegacyApps(apps)
		? apps.flatMap((group) => (Array.isArray(group?.items) ? group.items : []))
		: apps;
}

// ── Line mapping ──────────────────────────────────────────────────────────
// js-yaml reports syntax errors with a mark, but schema errors are ours. These
// scan the raw text so the editor can put the error on the right line.

function rawLines(raw) {
	return String(raw ?? '').split(/\r?\n/);
}

export function topLevelLine(raw, key) {
	const lines = rawLines(raw);
	const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
	const index = lines.findIndex((line) => re.test(line));
	return index === -1 ? undefined : index + 1;
}

/** 0-based line index of each direct `apps:` list item. */
export function appItemLineIndexes(raw) {
	const lines = rawLines(raw);
	const appsIndex = lines.findIndex((line) => /^apps\s*:\s*(#.*)?$/.test(line));
	if (appsIndex === -1) return [];

	let itemIndent = null;
	for (let i = appsIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || /^\s*#/.test(line)) continue;
		const item = line.match(/^(\s*)-\s+/);
		if (item) {
			itemIndent = item[1].length;
			break;
		}
		// A new top-level key before any item means `apps` is empty or inline.
		if (/^\S/.test(line)) return [];
	}
	if (itemIndent === null) return [];

	const starts = [];
	for (let i = appsIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || /^\s*#/.test(line)) continue;
		const indent = line.match(/^\s*/)[0].length;
		if (indent === 0 && !line.startsWith('-')) break;
		if (indent === itemIndent && line.slice(indent).startsWith('- ')) starts.push(i);
	}
	return starts;
}

function appFieldLine(raw, appIndex, field) {
	if (!Number.isInteger(appIndex)) return undefined;
	const lines = rawLines(raw);
	const starts = appItemLineIndexes(raw);
	if (appIndex < 0 || appIndex >= starts.length) return undefined;
	const start = starts[appIndex];
	const end = appIndex + 1 < starts.length ? starts[appIndex + 1] : lines.length;
	const re = new RegExp(`^\\s*(?:-\\s+)?${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
	for (let i = start; i < end; i++) {
		if (re.test(lines[i])) return i + 1;
	}
	return start + 1;
}

// ── Validation ────────────────────────────────────────────────────────────

function error(message, raw, details = {}) {
	const line =
		details.line ??
		(details.appIndex !== undefined && details.field
			? appFieldLine(raw, details.appIndex, details.field)
			: details.topKey
				? topLevelLine(raw, details.topKey)
				: undefined);
	return { message, line, ...(details.path ? { path: details.path } : {}) };
}

/**
 * Check the shape Holm needs, with line numbers when `raw` is supplied.
 * Returns [] when the config is usable. Unknown keys and values are allowed.
 */
export function validateConfigObject(config, raw = '') {
	const errors = [];
	if (!isMapping(config)) {
		errors.push({ message: 'config.yml must be a YAML mapping of settings.' });
		return errors;
	}

	if (config.apps !== undefined) {
		if (!Array.isArray(config.apps)) {
			errors.push(error('apps must be a list of apps.', raw, { topKey: 'apps', path: 'apps' }));
		} else {
			const legacy = isLegacyApps(config.apps);
			const apps = flattenApps(config.apps);
			const ids = new Set();
			apps.forEach((app, index) => {
				const appIndex = legacy ? undefined : index;
				const label = isMapping(app) && isText(app.id) && app.id.trim() ? `apps.${app.id}` : `apps[${index}]`;
				if (!isMapping(app)) {
					errors.push(error(`${label} must be a mapping with id, name and url.`, raw, { path: label }));
					return;
				}
				for (const field of ['id', 'name', 'url']) {
					if (!isText(app[field]) || !app[field].trim()) {
						errors.push(
							error(`${label}: ${field} is required and must be text.`, raw, {
								path: `${label}.${field}`,
								appIndex,
								field
							})
						);
					}
				}
				if (isText(app.id) && app.id.trim()) {
					const id = app.id.trim();
					if (/\s/.test(id)) {
						errors.push(
							error(`${label}: id must not contain spaces; use a slug like "${slugifyId(id)}".`, raw, {
								path: `${label}.id`,
								appIndex,
								field: 'id'
							})
						);
					}
					if (ids.has(id)) {
						errors.push(
							error(`apps.${id}: id is used by more than one app or service.`, raw, {
								path: `${label}.id`,
								appIndex,
								field: 'id'
							})
						);
					}
					ids.add(id);
				}
				for (const field of ['tags', 'groups']) {
					if (app[field] === undefined) continue;
					if (!Array.isArray(app[field])) {
						errors.push(
							error(`${label}: ${field} must be a list of strings.`, raw, {
								path: `${label}.${field}`,
								appIndex,
								field
							})
						);
					} else if (app[field].some((value) => !isText(value) || !value.trim())) {
						errors.push(
							error(`${label}: ${field} must contain only non-empty strings.`, raw, {
								path: `${label}.${field}`,
								appIndex,
								field
							})
						);
					}
				}
				for (const field of ['service', 'self_hosted', 'default_visible']) {
					if (app[field] !== undefined && typeof app[field] !== 'boolean') {
						errors.push(
							error(`${label}: ${field} must be true or false.`, raw, {
								path: `${label}.${field}`,
								appIndex,
								field
							})
						);
					}
				}
				if (app.app_store !== undefined) {
					if (!isMapping(app.app_store)) {
						errors.push(
							error(`${label}: app_store must be a mapping with ios and/or android links.`, raw, {
								path: `${label}.app_store`,
								appIndex,
								field: 'app_store'
							})
						);
					} else {
						for (const store of ['ios', 'android']) {
							if (app.app_store[store] !== undefined && !isText(app.app_store[store])) {
								errors.push(
									error(`${label}: app_store.${store} must be a URL.`, raw, {
										path: `${label}.app_store.${store}`,
										appIndex,
										field: 'app_store'
									})
								);
							}
						}
					}
				}
				if (app.description !== undefined && !isText(app.description)) {
					errors.push(
						error(`${label}: description must be text.`, raw, {
							path: `${label}.description`,
							appIndex,
							field: 'description'
						})
					);
				}
				if (app.browser_extension !== undefined && !isText(app.browser_extension)) {
					errors.push(
						error(`${label}: browser_extension must be a URL.`, raw, {
							path: `${label}.browser_extension`,
							appIndex,
							field: 'browser_extension'
						})
					);
				}
				if (app.icon !== undefined && !isText(app.icon) && !isMapping(app.icon)) {
					errors.push(
						error(`${label}: icon must be a di:/si: icon, a URL, or a {colored, mono} mapping.`, raw, {
							path: `${label}.icon`,
							appIndex,
							field: 'icon'
						})
					);
				}
			});
		}
	}

	if (config.search !== undefined) {
		if (!isMapping(config.search)) {
			errors.push(error('search must be a mapping.', raw, { topKey: 'search', path: 'search' }));
		} else {
			for (const field of ['url', 'param', 'name', 'icon']) {
				if (config.search[field] !== undefined && !isText(config.search[field])) {
					errors.push(
						error(`search.${field} must be text.`, raw, { topKey: 'search', path: `search.${field}` })
					);
				}
			}
			if (config.search.enabled !== undefined && typeof config.search.enabled !== 'boolean') {
				errors.push(
					error('search.enabled must be true or false.', raw, { topKey: 'search', path: 'search.enabled' })
				);
			}
		}
	}

	return errors;
}

/** js-yaml's message without the duplicated " at line …" suffix. */
function yamlErrorMessage(err) {
	const reason = err?.reason || err?.message || 'Invalid YAML';
	return String(reason).replace(/\s+at line \d+, column \d+.*$/i, '').trim();
}

/**
 * Parse and validate one editor buffer.
 * { ok, config, errors } — errors carry a 1-based `line` when known.
 */
export function parseConfigText(text) {
	if (typeof text !== 'string' || !text.trim()) {
		return { ok: false, config: null, errors: [{ message: 'config.yml is empty.' }] };
	}

	let config;
	try {
		config = yaml.load(text);
	} catch (err) {
		const mark = err?.mark;
		return {
			ok: false,
			config: null,
			errors: [
				{
					message: yamlErrorMessage(err),
					line: Number.isInteger(mark?.line) ? mark.line + 1 : undefined,
					column: Number.isInteger(mark?.column) ? mark.column + 1 : undefined
				}
			]
		};
	}

	const errors = validateConfigObject(config, text);
	return { ok: errors.length === 0, config: errors.length === 0 ? config : config ?? null, errors };
}

/** Serialize the edited config back to YAML (comments are not preserved). */
export function configToYaml(config) {
	const text = yaml.dump(config, {
		noRefs: true,
		lineWidth: -1,
		sortKeys: false,
		noCompatMode: true
	});
	return text.endsWith('\n') ? text : `${text}\n`;
}
