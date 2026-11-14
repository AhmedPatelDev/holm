import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { createBookmark, listBookmarkCategories, listBookmarks } from '$lib/server/db.js';
import { validateBookmark } from '$lib/bookmarks.js';

export async function GET({ cookies, url }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({
		bookmarks: await listBookmarks(user.username),
		categories: await listBookmarkCategories(user.username)
	});
}

export async function POST({ cookies, url, request }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const result = validateBookmark(body);
	if (!result.ok) return json({ error: 'Invalid bookmark', errors: result.errors }, { status: 400 });
	const bookmark = await createBookmark(user.username, result.value);
	if (!bookmark) return json({ error: 'Database is disabled' }, { status: 503 });
	return json({ bookmark }, { status: 201 });
}
