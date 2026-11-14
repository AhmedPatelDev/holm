import { dev } from '$app/environment';
import { getAuth } from '$lib/server/config.js';
import { getSessionUser } from '$lib/server/session.js';
import { getUserPrefs, listBookmarkCategories, listBookmarks } from '$lib/server/db.js';

export async function load({ cookies, url }) {
	const authConfig = getAuth();
	const user = getSessionUser(cookies, url);

	let authName = user?.name || null;
	let authUsername = user?.username || null;

	// Clean up one-time auth cookies
	if (cookies.get('auth_name') && !dev) {
		cookies.delete('auth_name', { path: '/' });
	}
	if (cookies.get('auth_username') && !dev) {
		cookies.delete('auth_username', { path: '/' });
	}

	// If auth is disabled, treat everyone as authenticated
	const isAuthenticated = !authConfig.enabled || !!authName;

	if (isAuthenticated) {
		// With auth off there is still a durable single-user account called
		// guest, so bookmarks and card settings have somewhere to live.
		const prefs = user ? await getUserPrefs(user.username) : null;
		return {
			authName: authName || (authConfig.enabled ? null : 'Guest'),
			authUsername: authUsername || null,
			devMode: dev,
			// Seed the client stores in the page payload (no /api/prefs round trip)
			prefs,
			bookmarks: user ? await listBookmarks(user.username) : [],
			bookmarkCategories: user ? await listBookmarkCategories(user.username) : []
		};
	}

	return { authName: null, authUsername: null, devMode: dev, prefs: null, bookmarks: [], bookmarkCategories: [] };
}
