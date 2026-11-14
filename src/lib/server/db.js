import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { getConfig } from './config.js';

let db = null;
let dbPath = null;

// Also decides where the integrations key file lives (secrets.js), so the
// key stays on whatever volume holds the database.
export function resolveDbPath() {
	return process.env.DATABASE_PATH || getConfig().database?.path || './data/holm.db';
}
let initPromise = null;

// Serializes async read-modify-write sequences (e.g. mergeUserPrefs) so two
// concurrent requests on the same key can't lose updates at await boundaries.
// sql.js itself is synchronous in-memory, so single-statement ops don't need
// this — only compositions that await between a read and a write do.
let writeLock = Promise.resolve();
function withLock(fn) {
	const run = writeLock.then(() => fn());
	// Don't poison the chain if fn throws.
	writeLock = run.catch(() => {});
	return run;
}

function saveToDisk() {
	if (!db || !dbPath) return;
	try {
		const data = db.export();
		// Atomic write: dump to a sibling temp file, then rename over the target.
		// Rename is atomic on POSIX within the same filesystem, so a crash
		// mid-write leaves the old DB intact instead of a truncated file.
		const tmpPath = `${dbPath}.tmp`;
		writeFileSync(tmpPath, Buffer.from(data));
		renameSync(tmpPath, dbPath);
	} catch (err) {
		console.error('[holm] Failed to save database:', err.message);
	}
}

async function ensureInit() {
	if (db === false) return; // disabled
	if (db) return; // already initialized
	if (initPromise) return initPromise; // initialization in progress

	initPromise = (async () => {
		const config = getConfig();
		const dbConfig = config.database || {};

		if (dbConfig.enabled === false) {
			db = false;
			console.log('[holm] Database disabled in config — using localStorage-only mode');
			return;
		}

		try {
			dbPath = resolveDbPath();
			mkdirSync(dirname(dbPath), { recursive: true });

			const SQL = await initSqlJs();

			// Load existing database file or create new
			if (existsSync(dbPath)) {
				const fileBuffer = readFileSync(dbPath);
				db = new SQL.Database(fileBuffer);
			} else {
				db = new SQL.Database();
			}

			db.run(`
			  CREATE TABLE IF NOT EXISTS user_prefs (
			    username     TEXT PRIMARY KEY,
			    prefs_json   TEXT NOT NULL DEFAULT '{}',
			    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
			  );


			  CREATE TABLE IF NOT EXISTS user_integrations (
			    username       TEXT NOT NULL,
			    integration_id TEXT NOT NULL,
			    config_blob    TEXT NOT NULL DEFAULT '',
			    surfaces_json  TEXT NOT NULL DEFAULT '{}',
			    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
			    PRIMARY KEY (username, integration_id)
			  );

			  -- The last version whose changelog each user closed. Kept out of
			  -- user_prefs, which the browser writes back whole.
			  CREATE TABLE IF NOT EXISTS user_changelog_seen (
			    username     TEXT PRIMARY KEY,
			    version      TEXT NOT NULL,
			    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
			  );

			  -- A person's own bookmarks, grouped by their own category names.
			  -- position is the manual order inside its category; category ''
			  -- means Uncategorized.
			  CREATE TABLE IF NOT EXISTS user_bookmarks (
			    id         INTEGER PRIMARY KEY AUTOINCREMENT,
			    username   TEXT NOT NULL,
			    title      TEXT NOT NULL,
			    url        TEXT NOT NULL,
			    subtitle   TEXT NOT NULL DEFAULT '',
			    category   TEXT NOT NULL DEFAULT '',
			    icon_url   TEXT NOT NULL DEFAULT '',
			    size       TEXT NOT NULL DEFAULT '',
			    position   INTEGER NOT NULL DEFAULT 0,
			    created_at TEXT NOT NULL DEFAULT (datetime('now')),
			    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			  );
			  CREATE INDEX IF NOT EXISTS user_bookmarks_user
			    ON user_bookmarks (username, category, position);

			  -- A user's category order. A bookmark can name a category that
			  -- isn't in here yet; the API adds it when the bookmark is saved.
			  CREATE TABLE IF NOT EXISTS user_bookmark_categories (
			    username   TEXT NOT NULL,
			    name       TEXT NOT NULL,
			    position   INTEGER NOT NULL DEFAULT 0,
			    created_at TEXT NOT NULL DEFAULT (datetime('now')),
			    PRIMARY KEY (username, name)
			  );

			  -- Resolved site icons, so a bookmark's favicon is fetched once per
			  -- host rather than on every dashboard load.
			  CREATE TABLE IF NOT EXISTS favicon_cache (
			    host         TEXT PRIMARY KEY,
			    icon_url     TEXT NOT NULL DEFAULT '',
			    content_type TEXT NOT NULL DEFAULT '',
			    data_base64  TEXT NOT NULL DEFAULT '',
			    fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
			  );
			`);

			saveToDisk();
			console.log('[holm] SQLite database initialized (sql.js)');
		} catch (err) {
			db = false;
			console.log('[holm] SQLite failed to initialize:', err.message);
		}
	})();

	return initPromise;
}

// Helper: run a SELECT and return rows as objects
function queryAll(sql, params = []) {
	const stmt = db.prepare(sql);
	if (params.length) stmt.bind(params);
	const rows = [];
	while (stmt.step()) {
		rows.push(stmt.getAsObject());
	}
	stmt.free();
	return rows;
}

function queryOne(sql, params = []) {
	const stmt = db.prepare(sql);
	if (params.length) stmt.bind(params);
	const row = stmt.step() ? stmt.getAsObject() : null;
	stmt.free();
	return row;
}

export async function getUserPrefs(username) {
	await ensureInit();
	// No database, no server copy: null tells the page to keep this
	// browser's prefs rather than replace them with an empty set.
	if (!db) return null;
	const row = queryOne('SELECT prefs_json FROM user_prefs WHERE username = ?', [username]);
	// No row yet: null says "keep this browser's copy", which matters on the
	// first visit with auth off. A stored {} is a real, cleared set.
	if (!row) return null;
	try { return JSON.parse(row.prefs_json); }
	catch { return {}; }
}

export async function upsertUserPrefs(username, prefs) {
	await ensureInit();
	if (!db) return;
	db.run(
		`INSERT INTO user_prefs (username, prefs_json, updated_at)
		 VALUES (?, ?, datetime('now'))
		 ON CONFLICT(username) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = datetime('now')`,
		[username, JSON.stringify(prefs)]
	);
	saveToDisk();
}

export async function mergeUserPrefs(username, partial) {
	await ensureInit();
	if (!db) return partial;
	// Hold the lock across read+merge+write. Everything inside the callback is
	// synchronous (no awaits), so no other request can interleave once we're in.
	return withLock(() => {
		const row = queryOne('SELECT prefs_json FROM user_prefs WHERE username = ?', [username]);
		let existing = {};
		if (row) {
			try { existing = JSON.parse(row.prefs_json); } catch {}
		}
		const merged = { ...existing, ...partial };
		db.run(
			`INSERT INTO user_prefs (username, prefs_json, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT(username) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = datetime('now')`,
			[username, JSON.stringify(merged)]
		);
		saveToDisk();
		return merged;
	});
}




// ─── Integrations (raw rows; encryption handled in store.js) ───────────────

export async function getIntegrationRow(username, integrationId) {
	await ensureInit();
	if (!db) return null;
	return queryOne(
		'SELECT username, integration_id, config_blob, surfaces_json, updated_at FROM user_integrations WHERE username = ? AND integration_id = ?',
		[username, integrationId]
	);
}

export async function listIntegrationRows(username) {
	await ensureInit();
	if (!db) return [];
	return queryAll(
		'SELECT username, integration_id, config_blob, surfaces_json, updated_at FROM user_integrations WHERE username = ?',
		[username]
	);
}

export async function upsertIntegrationRow(username, integrationId, configBlob, surfacesJson) {
	await ensureInit();
	if (!db) return;
	db.run(
		`INSERT INTO user_integrations (username, integration_id, config_blob, surfaces_json, updated_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(username, integration_id) DO UPDATE SET
		   config_blob   = excluded.config_blob,
		   surfaces_json = excluded.surfaces_json,
		   updated_at    = datetime('now')`,
		[username, integrationId, configBlob, surfacesJson]
	);
	saveToDisk();
}

export async function deleteIntegrationRow(username, integrationId) {
	await ensureInit();
	if (!db) return false;
	db.run('DELETE FROM user_integrations WHERE username = ? AND integration_id = ?', [username, integrationId]);
	// getRowsModified() counts the last statement only, so this is the DELETE.
	const changed = db.getRowsModified() > 0;
	if (changed) saveToDisk();
	return changed;
}

export async function isDatabaseEnabled() {
	await ensureInit();
	return !!db;
}

// ── Changelog ──────────────────────────────────────────────────

/** The last version this user closed the changelog on, or null. */
export async function getChangelogSeen(username) {
	await ensureInit();
	if (!db) return null;
	return queryOne('SELECT version FROM user_changelog_seen WHERE username = ?', [username])?.version || null;
}

export async function setChangelogSeen(username, version) {
	await ensureInit();
	if (!db) return;
	db.run(
		`INSERT INTO user_changelog_seen (username, version, updated_at)
		 VALUES (?, ?, datetime('now'))
		 ON CONFLICT(username) DO UPDATE SET version = excluded.version, updated_at = datetime('now')`,
		[username, version]
	);
	saveToDisk();
}

/** Whether this user has saved anything before: prefs or an integration. */
export async function isKnownUser(username) {
	await ensureInit();
	if (!db) return false;
	return !!(
		queryOne('SELECT 1 AS x FROM user_prefs WHERE username = ?', [username]) ||
		queryOne('SELECT 1 AS x FROM user_integrations WHERE username = ?', [username])
	);
}

// ─── Bookmarks ──────────────────────────────────────────────────────────────

function bookmarkRow(row) {
	if (!row) return null;
	return {
		id: row.id,
		title: row.title,
		url: row.url,
		subtitle: row.subtitle || '',
		category: row.category || '',
		iconUrl: row.icon_url || '',
		size: row.size || '',
		position: row.position ?? 0
	};
}

function categoryRow(row) {
	return { name: row.name, position: row.position ?? 0 };
}

export async function listBookmarks(username) {
	await ensureInit();
	if (!db) return [];
	return queryAll(
		`SELECT id, title, url, subtitle, category, icon_url, size, position
		   FROM user_bookmarks
		  WHERE username = ?
		  ORDER BY category COLLATE NOCASE ASC, position ASC, id ASC`,
		[username]
	).map(bookmarkRow);
}

export async function listBookmarkCategories(username) {
	await ensureInit();
	if (!db) return [];
	return queryAll(
		`SELECT name, position FROM user_bookmark_categories
		  WHERE username = ?
		  ORDER BY position ASC, name COLLATE NOCASE ASC`,
		[username]
	).map(categoryRow);
}

function nextBookmarkPosition(username, category) {
	const row = queryOne(
		'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM user_bookmarks WHERE username = ? AND category = ?',
		[username, category]
	);
	return row?.next ?? 0;
}

function nextCategoryPosition(username) {
	const row = queryOne(
		'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM user_bookmark_categories WHERE username = ?',
		[username]
	);
	return row?.next ?? 0;
}

/** Adds a category if this user doesn't have it yet; returns its name. */
export async function ensureBookmarkCategory(username, name) {
	await ensureInit();
	if (!db || !name) return name;
	const existing = queryOne(
		'SELECT name FROM user_bookmark_categories WHERE username = ? AND name = ?',
		[username, name]
	);
	if (!existing) {
		db.run(
			`INSERT INTO user_bookmark_categories (username, name, position)
			 VALUES (?, ?, ?)`,
			[username, name, nextCategoryPosition(username)]
		);
		saveToDisk();
	}
	return name;
}

export async function createBookmark(username, data) {
	await ensureInit();
	if (!db) return null;
	const category = data.category || '';
	if (category) await ensureBookmarkCategory(username, category);
	const position = nextBookmarkPosition(username, category);
	db.run(
		`INSERT INTO user_bookmarks (username, title, url, subtitle, category, icon_url, size, position)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[username, data.title, data.url, data.subtitle || '', category, data.iconUrl || '', data.size || '', position]
	);
	const id = queryOne('SELECT last_insert_rowid() AS id')?.id;
	saveToDisk();
	return bookmarkRow(
		queryOne(
			`SELECT id, title, url, subtitle, category, icon_url, size, position
			   FROM user_bookmarks WHERE id = ? AND username = ?`,
			[id, username]
		)
	);
}

export async function updateBookmark(username, id, data) {
	await ensureInit();
	if (!db) return null;
	const current = queryOne(
		'SELECT * FROM user_bookmarks WHERE id = ? AND username = ?',
		[id, username]
	);
	if (!current) return null;

	const category = data.category !== undefined ? data.category || '' : current.category;
	if (category && category !== current.category) await ensureBookmarkCategory(username, category);

	// Moving to another category puts the bookmark at the end of it, so the
	// next render has a stable, predictable position.
	const moved = category !== current.category;
	const position = moved ? nextBookmarkPosition(username, category) : current.position;

	db.run(
		`UPDATE user_bookmarks
		    SET title = ?, url = ?, subtitle = ?, category = ?, icon_url = ?, size = ?,
		        position = ?, updated_at = datetime('now')
		  WHERE id = ? AND username = ?`,
		[
			data.title !== undefined ? data.title : current.title,
			data.url !== undefined ? data.url : current.url,
			data.subtitle !== undefined ? data.subtitle || '' : current.subtitle,
			category,
			data.iconUrl !== undefined ? data.iconUrl || '' : current.icon_url,
			data.size !== undefined ? data.size || '' : current.size,
			position,
			id,
			username
		]
	);
	saveToDisk();
	return bookmarkRow(
		queryOne(
			`SELECT id, title, url, subtitle, category, icon_url, size, position
			   FROM user_bookmarks WHERE id = ? AND username = ?`,
			[id, username]
		)
	);
}

export async function deleteBookmark(username, id) {
	await ensureInit();
	if (!db) return false;
	db.run('DELETE FROM user_bookmarks WHERE id = ? AND username = ?', [id, username]);
	const changed = db.getRowsModified() > 0;
	if (changed) saveToDisk();
	return changed;
}

/**
 * Apply a new order. `items` is [{ id, category? }]; ids the user doesn't own
 * are ignored. Position is the index in the array. A category change is
 * allowed here so drag-and-drop between sections is one request.
 */
export async function reorderBookmarks(username, items) {
	await ensureInit();
	if (!db || !Array.isArray(items)) return listBookmarks(username);
	const owned = new Map(
		queryAll('SELECT id, category FROM user_bookmarks WHERE username = ?', [username]).map((r) => [r.id, r])
	);
	const touchedCategories = new Set();
	items.forEach((item, index) => {
		const row = owned.get(Number(item?.id));
		if (!row) return;
		const category = item.category !== undefined ? item.category || '' : row.category;
		if (category !== row.category) touchedCategories.add(category);
		db.run(
			`UPDATE user_bookmarks SET position = ?, category = ?, updated_at = datetime('now')
			  WHERE id = ? AND username = ?`,
			[index, category, row.id, username]
		);
	});
	for (const category of touchedCategories) {
		if (category) await ensureBookmarkCategory(username, category);
	}
	saveToDisk();
	return listBookmarks(username);
}

export async function createBookmarkCategory(username, name) {
	await ensureInit();
	if (!db || !name) return null;
	await ensureBookmarkCategory(username, name);
	return listBookmarkCategories(username);
}

export async function renameBookmarkCategory(username, from, to) {
	await ensureInit();
	if (!db || !from || !to) return listBookmarkCategories(username);
	const source = queryOne(
		'SELECT name FROM user_bookmark_categories WHERE username = ? AND name = ?',
		[username, from]
	);
	if (!source) return listBookmarkCategories(username);
	const target = queryOne(
		'SELECT name FROM user_bookmark_categories WHERE username = ? AND name = ?',
		[username, to]
	);
	if (target) {
		// Merge into the category that already exists.
		db.run(
			'UPDATE user_bookmarks SET category = ?, updated_at = datetime(\'now\') WHERE username = ? AND category = ?',
			[to, username, from]
		);
		db.run('DELETE FROM user_bookmark_categories WHERE username = ? AND name = ?', [username, from]);
	} else {
		db.run(
			'UPDATE user_bookmark_categories SET name = ? WHERE username = ? AND name = ?',
			[to, username, from]
		);
		db.run(
			'UPDATE user_bookmarks SET category = ?, updated_at = datetime(\'now\') WHERE username = ? AND category = ?',
			[to, username, from]
		);
	}
	saveToDisk();
	return listBookmarkCategories(username);
}

/**
 * Delete a category. Its bookmarks move to `moveTo` (a category name), or to
 * Uncategorized when that is empty. Returns the fresh category list.
 */
export async function deleteBookmarkCategory(username, name, moveTo = '') {
	await ensureInit();
	if (!db || !name) return listBookmarkCategories(username);
	if (moveTo) await ensureBookmarkCategory(username, moveTo);
	db.run(
		'UPDATE user_bookmarks SET category = ?, updated_at = datetime(\'now\') WHERE username = ? AND category = ?',
		[moveTo || '', username, name]
	);
	db.run('DELETE FROM user_bookmark_categories WHERE username = ? AND name = ?', [username, name]);
	saveToDisk();
	return listBookmarkCategories(username);
}

export async function reorderBookmarkCategories(username, names) {
	await ensureInit();
	if (!db || !Array.isArray(names)) return listBookmarkCategories(username);
	const owned = new Set(
		queryAll('SELECT name FROM user_bookmark_categories WHERE username = ?', [username]).map((r) => r.name)
	);
	names.forEach((name, index) => {
		if (!owned.has(name)) return;
		db.run(
			'UPDATE user_bookmark_categories SET position = ? WHERE username = ? AND name = ?',
			[index, username, name]
		);
	});
	saveToDisk();
	return listBookmarkCategories(username);
}

// ─── Favicon cache ──────────────────────────────────────────────────────────

export async function getFaviconCache(host) {
	await ensureInit();
	if (!db) return null;
	return queryOne(
		'SELECT host, icon_url, content_type, data_base64, fetched_at FROM favicon_cache WHERE host = ?',
		[host]
	);
}

export async function putFaviconCache(host, iconUrl, contentType, dataBase64) {
	await ensureInit();
	if (!db) return;
	db.run(
		`INSERT INTO favicon_cache (host, icon_url, content_type, data_base64, fetched_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(host) DO UPDATE SET
		   icon_url = excluded.icon_url,
		   content_type = excluded.content_type,
		   data_base64 = excluded.data_base64,
		   fetched_at = datetime('now')`,
		[host, iconUrl || '', contentType || '', dataBase64 || '']
	);
	saveToDisk();
}

export async function deleteFaviconCache(host) {
	await ensureInit();
	if (!db) return;
	db.run('DELETE FROM favicon_cache WHERE host = ?', [host]);
	saveToDisk();
}
