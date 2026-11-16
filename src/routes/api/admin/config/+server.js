import { json } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/appAccess.js';
import { getSessionUser } from '$lib/server/session.js';
import { readAdminConfig, saveAdminConfig } from '$lib/server/configAdmin.js';

// Reading or writing config.yml is admin-only. The check runs on every
// request here, not just in the UI: the tab is hidden from everyone else, but
// a crafted request must still get 403.
function gate({ cookies, url }) {
	const user = getSessionUser(cookies, url);
	if (!user) return { response: json({ error: 'Unauthorized' }, { status: 401 }) };
	if (!isAdmin(user)) return { response: json({ error: 'Forbidden' }, { status: 403 }) };
	return { user };
}

export function GET(event) {
	const { response } = gate(event);
	if (response) return response;
	try {
		return json(readAdminConfig(), { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		return json({ error: `Could not read config.yml: ${err.message}` }, { status: 500 });
	}
}

export async function PUT(event) {
	const { response } = gate(event);
	if (response) return response;

	let body;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	if (typeof body?.yaml !== 'string') {
		return json({ error: 'Missing yaml field' }, { status: 400 });
	}

	const result = saveAdminConfig(body.yaml);
	if (!result.ok) {
		const { status = 400, ...payload } = result;
		return json(payload, { status });
	}
	return json(result, { headers: { 'cache-control': 'no-store' } });
}
