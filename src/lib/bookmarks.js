// Pure bookmark and category helpers. No DOM, no Svelte, no I/O, so the same
// rules run in the editor, in the API and in the unit tests.

import { resolveIcon } from './apps.js';

export const UNCATEGORIZED = 'Uncategorized';
export const GENERAL = 'General';

export const CARD_SIZES = ['compact', 'medium', 'wide'];
export const DEFAULT_CARD_SIZE = 'medium';

export const MAX_TITLE = 120;
export const MAX_SUBTITLE = 240;
export const MAX_CATEGORY = 60;
export const MAX_URL = 2048;

/** A display label for a category, with the empty one named. */
export function categoryLabel(name) {
	return (name || '').trim() || UNCATEGORIZED;
}

/**
 * Normalize a typed URL. A bare `example.com` gets https://, which is what
 * people type; anything else must already be a valid http(s) URL.
 * Returns { url } or { error }.
 */
export function normalizeUrl(input) {
	const raw = String(input || '').trim();
	if (!raw) return { error: 'URL is required' };
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
	if (withScheme.length > MAX_URL) return { error: 'URL is too long' };
	let parsed;
	try {
		parsed = new URL(withScheme);
	} catch {
		return { error: 'Enter a valid URL' };
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return { error: 'URL must start with http:// or https://' };
	}
	if (!parsed.hostname) return { error: 'Enter a valid URL' };
	return { url: parsed.href };
}

/** Shared field rules for create and update. */
export function validateBookmark(input = {}) {
	const errors = {};
	const title = String(input.title ?? '').trim();
	if (!title) errors.title = 'Title is required';
	else if (title.length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters`;

	const urlResult = normalizeUrl(input.url);
	if (urlResult.error) errors.url = urlResult.error;

	const subtitle = String(input.subtitle ?? '').trim();
	if (subtitle.length > MAX_SUBTITLE) errors.subtitle = `Keep the subtitle under ${MAX_SUBTITLE} characters`;

	const category = String(input.category ?? '').trim();
	if (category.length > MAX_CATEGORY) errors.category = `Keep the category under ${MAX_CATEGORY} characters`;

	let iconUrl = String(input.iconUrl ?? '').trim();
	if (iconUrl) {
		const iconResult = normalizeUrl(iconUrl);
		if (iconResult.error) errors.iconUrl = 'Enter a valid icon URL';
		else iconUrl = iconResult.url;
	}

	const size = String(input.size ?? '').trim();
	if (size && !CARD_SIZES.includes(size)) errors.size = 'Unknown card size';

	return {
		ok: Object.keys(errors).length === 0,
		errors,
		value: {
			title,
			url: urlResult.url || '',
			subtitle,
			category,
			iconUrl,
			size
		}
	};
}

/**
 * The per-item override, or the global card size. Both tabs share the global
 * setting; a bookmark can opt into its own size.
 */
export function effectiveCardSize(itemSize, globalSize) {
	return CARD_SIZES.includes(itemSize) ? itemSize : CARD_SIZES.includes(globalSize) ? globalSize : DEFAULT_CARD_SIZE;
}

/**
 * Group bookmarks under their categories. Category rows carry the user's
 * order; a category that only exists on a bookmark is appended, and
 * Uncategorized always comes last. `items` keeps the stored order.
 */
export function groupBookmarks(bookmarks = [], categories = []) {
	const groups = new Map();
	for (const category of categories) {
		const name = String(category?.name ?? category ?? '').trim();
		if (!name || groups.has(name)) continue;
		groups.set(name, []);
	}
	for (const bookmark of bookmarks || []) {
		const name = String(bookmark?.category ?? '').trim();
		if (!groups.has(name)) groups.set(name, []);
		groups.get(name).push(bookmark);
	}
	const out = [];
	for (const [name, items] of groups) {
		if (!items.length && !name) continue;
		out.push({ key: name || '__uncategorized', name, label: categoryLabel(name), items });
	}
	// Uncategorized last, whether or not the user put it in the order.
	out.sort((a, b) => {
		if (!a.name) return 1;
		if (!b.name) return -1;
		return 0;
	});
	return out;
}

/** The category an app falls under on the Portal tab. */
export function portalCategory(app, overrides = {}) {
	const override = overrides?.[app?.id];
	if (override) return String(override).trim();
	const tag = Array.isArray(app?.tags) ? app.tags.find((t) => String(t || '').trim()) : null;
	return String(tag || GENERAL).trim();
}

/**
 * Group Portal apps by their first tag (or the user's override). `order` is
 * the user's category order; categories not in it follow alphabetically.
 * The fallback category is last unless the user placed it.
 */
export function groupPortalApps(apps = [], { order = [], overrides = {} } = {}) {
	const groups = new Map();
	for (const app of apps || []) {
		const name = portalCategory(app, overrides);
		if (!groups.has(name)) groups.set(name, []);
		groups.get(name).push(app);
	}
	const orderIndex = new Map((order || []).map((name, i) => [String(name).toLowerCase(), i]));
	const names = [...groups.keys()];
	names.sort((a, b) => {
		const ai = orderIndex.get(a.toLowerCase());
		const bi = orderIndex.get(b.toLowerCase());
		if (ai !== undefined || bi !== undefined) {
			if (ai === undefined) return 1;
			if (bi === undefined) return -1;
			return ai - bi;
		}
		if (a === GENERAL) return 1;
		if (b === GENERAL) return -1;
		return a.localeCompare(b);
	});
	return names.map((name) => ({ key: name, name, label: name, items: groups.get(name) }));
}

/** The server route that resolves and caches a site's favicon. */
export function faviconUrl(url) {
	return `/api/favicon?url=${encodeURIComponent(url || '')}`;
}

/**
 * An icon descriptor for a bookmark that AppIcon understands: the manual
 * override when present, otherwise Holm's favicon endpoint. AppIcon falls
 * back to a monogram when the endpoint 404s.
 */
export function bookmarkIcon(bookmark) {
	if (bookmark?.iconUrl) return resolveIcon(bookmark.iconUrl);
	return resolveIcon(faviconUrl(bookmark?.url));
}

/** A search-bar/portal-shaped app for a bookmark. */
export function bookmarkToApp(bookmark) {
	return {
		id: `bookmark-${bookmark.id}`,
		name: bookmark.title,
		url: bookmark.url,
		icon: bookmarkIcon(bookmark),
		subtitle: bookmark.subtitle || '',
		selfHosted: false,
		default: true,
		ios: null,
		android: null,
		extension: null,
		tags: [categoryLabel(bookmark.category)],
		isBookmark: true
	};
}

/** Host shown under a wide card's title. */
export function urlHost(url) {
	try {
		return new URL(url).host;
	} catch {
		return '';
	}
}
