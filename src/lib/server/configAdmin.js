// Read and replace config.yml from Configure → Config.
//
// Saving is deliberately conservative: validate first, write a rolling
// config.yml.bak, write a sibling temp file, rename it over the target, and
// only then reload the in-memory config. A bind-mounted file can refuse the
// rename (EBUSY/EPERM); there we fall back to an in-place write, still after
// the backup. If the new file somehow fails the loader's checks, the previous
// content is restored so a bad UI save can't take the server down.

import {
	accessSync,
	constants,
	existsSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { flattenApps, parseConfigText, topLevelLine } from '../adminConfig.js';
import { getConfigPath, reloadConfig } from './config.js';
import { substituteEnvVars } from './envVars.js';
import { searchOnFocusError } from '../searchOnFocus.js';
import { searchLookError } from '../searchLook.js';
import { themeBackgroundError } from '../themeBackground.js';
import { wallpapersError } from './wallpapers.js';
import { healthError } from './health/config.js';

const READ_ONLY_HINT = (path) =>
	`config.yml is read-only at ${path}. The editor can read it, but saving is disabled. ` +
	'In Docker, change the config.yml volume from ":ro" to ":rw" and restart the container.';

const WRITE_FAILED_HINT = (path, err) =>
	`Could not write config.yml at ${path} (${err?.code || err?.message || 'write failed'}). ` +
	'Check that the file and its folder are writable by the Holm container.';

export function resolveConfigPath() {
	return resolve(getConfigPath());
}

function canWrite(path) {
	try {
		accessSync(path, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function backupInfo(path) {
	const backupPath = `${path}.bak`;
	try {
		const stat = statSync(backupPath);
		return {
			path: backupPath,
			exists: true,
			bytes: stat.size,
			modified: stat.mtime.toISOString()
		};
	} catch {
		return { path: backupPath, exists: false };
	}
}

/** Everything the Config tab needs to render, without ever writing. */
export function readAdminConfig() {
	const path = resolveConfigPath();
	const exists = existsSync(path);
	const raw = exists ? readFileSync(path, 'utf-8') : '';
	const parsed = raw
		? parseConfigText(raw)
		: { ok: false, config: null, errors: [{ message: `config.yml was not found at ${path}.` }] };
	return {
		path,
		exists,
		writable: exists ? canWrite(path) : canWrite(dirname(path)),
		raw,
		config: parsed.config,
		errors: parsed.errors,
		backup: backupInfo(path)
	};
}

// The loader's extra checks, which guard settings the shared schema lets
// through (search look, wallpaper source, health monitors, page colours).
function loaderError(config, raw) {
	const apps = flattenApps(config.apps);
	const invalid =
		searchOnFocusError(config.search) ||
		searchLookError(config.search) ||
		themeBackgroundError(config.branding) ||
		wallpapersError(config.wallpapers) ||
		healthError(config, apps);
	if (!invalid) return [];
	const key = String(invalid).match(/^(search|branding|wallpapers|health|apps)\b/)?.[1];
	return [{ message: invalid, line: key ? topLevelLine(raw, key) : undefined }];
}

function writeAtomically(path, text) {
	const dir = dirname(path);
	const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	let fallback = false;
	try {
		writeFileSync(tmp, text, 'utf-8');
		try {
			renameSync(tmp, path);
		} catch (err) {
			// A bind-mounted file, or Windows while another process holds it,
			// may not allow rename-over. Keep the backup and write in place.
			if (['EBUSY', 'EPERM', 'EACCES', 'EXDEV', 'EEXIST'].includes(err?.code)) {
				writeFileSync(path, text, 'utf-8');
				fallback = true;
			} else {
				throw err;
			}
		}
		return { fallback };
	} finally {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {
			/* best effort */
		}
	}
}

/**
 * Validate and save a new config.yml body.
 * { ok: true, ... } or { ok: false, status, error, errors?, readOnly? }.
 */
export function saveAdminConfig(text) {
	if (typeof text !== 'string') return { ok: false, status: 400, error: 'Missing config.yml text.' };
	if (text.length > 512 * 1024) return { ok: false, status: 413, error: 'config.yml is too large to save.' };

	const parsed = parseConfigText(text);
	if (!parsed.ok) {
		return {
			ok: false,
			status: 400,
			error: parsed.errors[0]?.message || 'Invalid config.yml.',
			errors: parsed.errors
		};
	}

	let substituted;
	try {
		substituted = substituteEnvVars(parsed.config);
	} catch (err) {
		return {
			ok: false,
			status: 400,
			error: err.message,
			errors: [{ message: err.message }]
		};
	}

	const extra = loaderError(substituted, text);
	if (extra.length) {
		return { ok: false, status: 400, error: extra[0].message, errors: extra };
	}

	const path = resolveConfigPath();
	if (!existsSync(path)) {
		return { ok: false, status: 404, error: `config.yml was not found at ${path}.` };
	}
	if (!canWrite(path)) {
		return { ok: false, status: 403, readOnly: true, error: READ_ONLY_HINT(path) };
	}

	const old = readFileSync(path, 'utf-8');
	const backupPath = `${path}.bak`;
	try {
		writeFileSync(backupPath, old, 'utf-8');
	} catch (err) {
		return {
			ok: false,
			status: 500,
			error: `Could not write backup ${backupPath} (${err?.code || err?.message}); refusing to overwrite config.yml.`
		};
	}

	let wrote;
	try {
		wrote = writeAtomically(path, text);
	} catch (err) {
		if (['EACCES', 'EPERM', 'EROFS'].includes(err?.code)) {
			return { ok: false, status: 403, readOnly: true, error: READ_ONLY_HINT(path) };
		}
		return { ok: false, status: 500, error: WRITE_FAILED_HINT(path, err) };
	}

	try {
		reloadConfig();
	} catch (err) {
		// The loader disagreed with the UI's checks. Put the old file back so
		// the running server keeps working, and report the real reason.
		try {
			writeFileSync(path, old, 'utf-8');
			reloadConfig();
		} catch {
			/* the old file is still on disk; next request surfaces the error */
		}
		return {
			ok: false,
			status: 400,
			error: `The saved config was rejected by Holm: ${err.message}`,
			errors: [{ message: err.message }]
		};
	}

	return {
		ok: true,
		path,
		writable: true,
		raw: text,
		config: parsed.config,
		errors: [],
		backup: backupInfo(path),
		fallback: wrote.fallback,
		reloaded: true
	};
}
