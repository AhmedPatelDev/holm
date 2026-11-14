// The web search engine behind the top bar. A person can pick a preset or
// point Holm at their own SearXNG in Configure → General; with no pick, the
// server's `search:` entry from config.yml applies. Both the bar's icon and
// placeholder and the launcher's web fallback read this one resolution, so
// they always agree.

export const SEARCH_ENGINES = [
	{ id: 'default', label: 'Server default' },
	{ id: 'google', label: 'Google', url: 'https://www.google.com/search', param: 'q', icon: 'si:google' },
	{ id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/', param: 'q', icon: 'si:duckduckgo' },
	{ id: 'brave', label: 'Brave Search', url: 'https://search.brave.com/search', param: 'q', icon: 'si:brave' },
	{ id: 'startpage', label: 'Startpage', url: 'https://www.startpage.com/sp/search', param: 'query', icon: 'si:startpage' },
	{ id: 'kagi', label: 'Kagi', url: 'https://kagi.com/search', param: 'q', icon: 'si:kagi' },
	{ id: 'custom', label: 'SearXNG / Custom' }
];

const PRESETS = Object.fromEntries(SEARCH_ENGINES.filter((e) => e.url).map((e) => [e.id, e]));

// Nicer names and marks than a bare hostname for the engines people most
// often set under search.url in config.yml.
const KNOWN_HOSTS = [
	{ match: /(^|\.)google\./, name: 'Google', icon: 'si:google' },
	{ match: /(^|\.)duckduckgo\./, name: 'DuckDuckGo', icon: 'si:duckduckgo' },
	{ match: /(^|\.)brave\./, name: 'Brave Search', icon: 'si:brave' },
	{ match: /(^|\.)startpage\./, name: 'Startpage', icon: 'si:startpage' },
	{ match: /(^|\.)kagi\./, name: 'Kagi', icon: 'si:kagi' },
	{ match: /(^|\.)searx/, name: 'SearXNG', icon: null },
	{ match: /(^|\.)ecosia\./, name: 'Ecosia', icon: null }
];

function hostInfo(raw) {
	try {
		const host = new URL(raw).hostname.replace(/^www\./, '');
		const known = KNOWN_HOSTS.find((k) => k.match.test(host));
		return {
			host,
			name: known?.name || host,
			icon: known?.icon || null
		};
	} catch {
		return { host: '', name: null, icon: null };
	}
}

function clean(value) {
	return typeof value === 'string' ? value.trim() : '';
}

// The server's configured engine, with a friendly name and icon when the
// URL is one we recognise.
export function serverSearchEngine(serverSearch = {}) {
	const url = clean(serverSearch?.url);
	if (!url) return null;
	const info = hostInfo(url);
	return {
		id: 'default',
		name: clean(serverSearch?.name) || info.name || info.host || 'the web',
		url,
		param: clean(serverSearch?.param) || 'q',
		icon: clean(serverSearch?.icon) || info.icon,
		serverDefault: true
	};
}

// The engine in effect for this person. A custom entry without a URL, or an
// unknown preset id, falls back to the server default rather than leaving
// the bar without a target.
export function effectiveSearchEngine(prefs = {}, serverSearch = {}) {
	const fallback = serverSearchEngine(serverSearch);
	const id = clean(prefs?.searchEngine) || 'default';

	if (id === 'custom') {
		const url = clean(prefs?.searchEngineUrl);
		if (!url) return fallback;
		const info = hostInfo(url);
		return {
			id: 'custom',
			name: clean(prefs?.searchEngineName) || info.name || info.host || 'Custom',
			url,
			param: clean(prefs?.searchEngineParam) || 'q',
			icon: clean(prefs?.searchEngineIcon) || info.icon,
			custom: true
		};
	}

	const preset = PRESETS[id];
	if (preset) {
		return {
			id: preset.id,
			name: preset.label,
			url: preset.url,
			param: preset.param,
			icon: preset.icon
		};
	}

	return fallback;
}

// One URL for a query, replacing an existing `?q=` placeholder instead of
// stacking a second one. Used by the launcher row and the form's submit.
export function buildSearchUrl(engine, query) {
	const raw = clean(engine?.url);
	if (!raw) return null;
	const param = clean(engine?.param) || 'q';
	try {
		const url = new URL(raw);
		url.searchParams.set(param, query);
		return url.toString();
	} catch {
		return `${raw}${raw.includes('?') ? '&' : '?'}${encodeURIComponent(param)}=${encodeURIComponent(query)}`;
	}
}
