import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { reorderBookmarks } from '$lib/server/db.js';

export async function PUT({ cookies, url, request }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	if (!Array.isArray(body.items) || body.items.length > 2000) {
		return json({ error: 'items must be an array' }, { status: 400 });
	}
	const items = body.items
		.filter((item) => item && Number.isInteger(Number(item.id)))
		.map((item) => ({
			id: Number(item.id),
			...(item.category !== undefined ? { category: String(item.category || '').slice(0, 60) } : {})
		}));
	return json({ bookmarks: await reorderBookmarks(user.username, items) });
}
