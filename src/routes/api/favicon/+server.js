import { getFaviconCache, putFaviconCache } from '$lib/server/db.js';

// GET /api/favicon?url=https://example.com/page
//
// Resolves a bookmark's site icon server-side (the browser can't read another
// origin's HTML, and many sites block hot-linking), then caches the bytes in
// SQLite. A miss is a 404 and the client falls back to a monogram.
//
// This deliberately follows the bookmark's host, including private addresses:
// Holm is a homelab dashboard, and an icon from 192.168.1.20 is the point.
// Only http(s) is accepted, never file: or other schemes.

const MAX_BYTES = 256 * 1024;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7000;
const MAX_CANDIDATES = 8;

const inFlight = new Map();

function targetUrl(raw) {
	let parsed;
	try {
		parsed = new URL(String(raw || ''));
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	if (parsed.username || parsed.password) return null;
	return parsed;
}

function contentTypeFor(url, header) {
	const type = String(header || '').split(';')[0].trim().toLowerCase();
	if (type === 'image/svg+xml' || type === 'image/svg') return 'image/svg+xml';
	if (type.startsWith('image/')) return type;
	if (type === 'application/octet-stream' || type === 'binary/octet-stream') {
		if (/\.svg$/i.test(url)) return 'image/svg+xml';
		if (/\.ico$/i.test(url)) return 'image/x-icon';
		if (/\.png$/i.test(url)) return 'image/png';
		if (/\.jpe?g$/i.test(url)) return 'image/jpeg';
		if (/\.webp$/i.test(url)) return 'image/webp';
		if (/\.gif$/i.test(url)) return 'image/gif';
	}
	// Some servers mislabel SVGs as text/xml.
	if ((type === 'text/xml' || type === 'application/xml') && /\.svg$/i.test(url)) return 'image/svg+xml';
	return null;
}

async function fetchBytes(url, { html = false } = {}) {
	const res = await fetch(url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		headers: {
			'user-agent': 'Holm/1.0 (+https://github.com/man15h/holm) favicon',
			accept: html ? 'text/html,application/xhtml+xml' : 'image/*,*/*;q=0.8'
		}
	});
	if (!res.ok) return null;
	const body = await res.arrayBuffer();
	if (!body.byteLength || body.byteLength > MAX_BYTES) return null;
	return { body, type: res.headers.get('content-type') || '', url: res.url || url };
}

function attribute(tag, name) {
	const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
	if (quoted) return quoted[2];
	const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
	return bare ? bare[1] : '';
}

/** Every <link rel="...icon..."> href, resolved against the page URL. */
function iconLinks(html, baseUrl) {
	const out = [];
	const links = html.match(/<link\b[^>]*>/gi) || [];
	for (const tag of links) {
		const rel = attribute(tag, 'rel').toLowerCase();
		if (!rel.includes('icon')) continue;
		const href = attribute(tag, 'href');
		if (!href) continue;
		try {
			const url = new URL(href, baseUrl).href;
			if (!/^https?:/i.test(url)) continue;
			const size = Number(attribute(tag, 'sizes').split('x')[0]) || 0;
			// Apple touch icons are usually the high-resolution choice.
			out.push({ url, score: rel.includes('apple-touch') ? 1000 + size : size });
		} catch {
			// Ignore a malformed href.
		}
	}
	out.sort((a, b) => b.score - a.score);
	return out.map((x) => x.url);
}

async function resolveFavicon(parsed) {
	const origin = parsed.origin;
	const candidates = [];
	try {
		const page = await fetchBytes(parsed.href, { html: true });
		if (page) {
			const html = new TextDecoder().decode(page.body.slice(0, 512 * 1024));
			candidates.push(...iconLinks(html, page.url));
		}
	} catch {
		// An unreachable page can still have a conventional /favicon.ico.
	}
	candidates.push(`${origin}/favicon.ico`);
	candidates.push(`https://icons.duckduckgo.com/ip3/${parsed.hostname}.ico`);
	candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`);

	const seen = new Set();
	for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		const icon = await fetchBytes(candidate).catch(() => null);
		if (!icon) continue;
		const type = contentTypeFor(icon.url, icon.type);
		if (!type) continue;
		return { body: icon.body, type, url: icon.url };
	}
	return null;
}

export async function GET({ url }) {
	const parsed = targetUrl(url.searchParams.get('url'));
	if (!parsed) return new Response('Bad request', { status: 400 });

	const host = parsed.host.toLowerCase();
	const cached = await getFaviconCache(host).catch(() => null);
	const fresh = cached?.data_base64 && Date.now() - Date.parse(`${cached.fetched_at.replace(' ', 'T')}Z`) < TTL_MS;
	if (fresh) return imageResponse(cached.content_type, cached.data_base64);

	let pending = inFlight.get(host);
	if (!pending) {
		pending = resolveFavicon(parsed)
			.then(async (icon) => {
				if (!icon) return null;
				const base64 = Buffer.from(icon.body).toString('base64');
				await putFaviconCache(host, icon.url, icon.type, base64).catch(() => {});
				return { type: icon.type, base64 };
			})
			.finally(() => inFlight.delete(host));
		inFlight.set(host, pending);
	}
	const resolved = await pending;
	if (resolved) return imageResponse(resolved.type, resolved.base64);
	if (cached?.data_base64) return imageResponse(cached.content_type, cached.data_base64);

	return new Response('Not found', {
		status: 404,
		headers: { 'cache-control': 'public, max-age=3600' }
	});
}

function imageResponse(type, base64) {
	const headers = {
		'content-type': type,
		'x-content-type-options': 'nosniff',
		'cache-control': 'public, max-age=86400, stale-while-revalidate=604800'
	};
	// An SVG is third-party content served from Holm's origin, so sandbox it.
	if (type === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
	return new Response(Buffer.from(base64, 'base64'), { headers });
}
