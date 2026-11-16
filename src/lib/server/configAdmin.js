// Read and replace config.yml from Configure → Config.
//
// Saving is deliberately conservative: validate first, write a rolling
// config.yml.bak, overwrite config.yml, and only then reload the in-memory
// config. The backup lives next to holm.db on the writable data volume, never
// beside config.yml: in Docker config.yml is a single-file bind mount inside a
// root-owned /app, where creating a file or renaming over it fails with EACCES
// or EBUSY. Writing the file's contents directly works on that mount. If the
// new file somehow fails the loader's checks, the previous content is restored
// so a bad UI save can't take the server down.

import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from 'fs';
import { dirname, join, resolve } from 'path';
import { flattenApps, parseConfigText, topLevelLine } from '../adminConfig.js';
import { getConfigPath, reloadConfig } from './config.js';
import { resolveDbPath } from './db.js';
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
	'Check that the file is writable by the Holm container.';

export function resolveConfigPath() {
	return resolve(getConfigPath());
}

// The backup belongs on the data volume, alongside holm.db, not in the config
// directory. Docker's single-file bind mount leaves /app root-owned and
// read-only even when config.yml itself is writable. Purely a path: the
// directory is created on save, so a read-only GET can still report it.
export function resolveBackupPath() {
	return join(dirname(resolve(resolveDbPath())), 'config.yml.bak');
}

function canWrite(path) {
	try {
		accessSync(path, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function backupInfo() {
	const backupPath = resolveBackupPath();
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
		backup: backupInfo()
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
	const backupPath = resolveBackupPath();
	try {
		mkdirSync(dirname(backupPath), { recursive: true });
		writeFileSync(backupPath, old, 'utf-8');
	} catch (err) {
		return {
			ok: false,
			status: 500,
			error: `Could not write backup ${backupPath} (${err?.code || err?.message}); refusing to overwrite config.yml.`
		};
	}

	try {
		// Not a temp file + rename: on a single-file bind mount the config's
		// directory is not ours to create files in, but the mounted file itself
		// accepts a straight overwrite.
		writeFileSync(path, text, 'utf-8');
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
		backup: backupInfo(),
		reloaded: true
	};
}
