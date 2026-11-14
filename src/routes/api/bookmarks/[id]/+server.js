import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { deleteBookmark, listBookmarks, updateBookmark } from '$lib/server/db.js';
import { validateBookmark } from '$lib/bookmarks.js';

function idFrom(params) {
	const id = Number(params.id);
	return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH({ cookies, url, request, params }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = idFrom(params);
	if (!id) return json({ error: 'Invalid bookmark id' }, { status: 400 });

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	// PATCH keeps unsent fields: merge them over the stored bookmark before
	// validating, so a title-only edit doesn't clear the URL.
	const existing = (await listBookmarks(user.username)).find((b) => b.id === id);
	if (!existing) return json({ error: 'Not found' }, { status: 404 });
	const result = validateBookmark({
		title: body.title ?? existing.title,
		url: body.url ?? existing.url,
		subtitle: body.subtitle ?? existing.subtitle,
		category: body.category ?? existing.category,
		iconUrl: body.iconUrl ?? existing.iconUrl,
		size: body.size ?? existing.size
	});
	if (!result.ok) return json({ error: 'Invalid bookmark', errors: result.errors }, { status: 400 });

	const bookmark = await updateBookmark(user.username, id, result.value);
	if (!bookmark) return json({ error: 'Not found' }, { status: 404 });
	return json({ bookmark });
}

export async function DELETE({ cookies, url, params }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = idFrom(params);
	if (!id) return json({ error: 'Invalid bookmark id' }, { status: 400 });
	const deleted = await deleteBookmark(user.username, id);
	if (!deleted) return json({ error: 'Not found' }, { status: 404 });
	return json({ ok: true });
}
