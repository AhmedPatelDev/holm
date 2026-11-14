import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import {
	createBookmarkCategory,
	deleteBookmarkCategory,
	listBookmarkCategories,
	renameBookmarkCategory,
	reorderBookmarkCategories
} from '$lib/server/db.js';
import { MAX_CATEGORY } from '$lib/bookmarks.js';

function cleanName(value) {
	return String(value ?? '').trim().slice(0, MAX_CATEGORY);
}

export async function GET({ cookies, url }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ categories: await listBookmarkCategories(user.username) });
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
	const name = cleanName(body.name);
	if (!name) return json({ error: 'Category name is required' }, { status: 400 });
	return json({ categories: await createBookmarkCategory(user.username, name) }, { status: 201 });
}

export async function PATCH({ cookies, url, request }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const from = cleanName(body.from);
	const to = cleanName(body.to);
	if (!from || !to) return json({ error: 'from and to are required' }, { status: 400 });
	return json({ categories: await renameBookmarkCategory(user.username, from, to) });
}

export async function PUT({ cookies, url, request }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	if (!Array.isArray(body.names)) return json({ error: 'names must be an array' }, { status: 400 });
	const names = body.names.map(cleanName).filter(Boolean).slice(0, 500);
	return json({ categories: await reorderBookmarkCategories(user.username, names) });
}

export async function DELETE({ cookies, url }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	const name = cleanName(url.searchParams.get('name'));
	if (!name) return json({ error: 'name is required' }, { status: 400 });
	const moveTo = cleanName(url.searchParams.get('moveTo'));
	return json({ categories: await deleteBookmarkCategory(user.username, name, moveTo) });
}
