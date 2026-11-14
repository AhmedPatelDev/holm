<script>
	import { onMount, untrack, getContext } from 'svelte';
	import { browser } from '$app/environment';
	import { prefs } from '$lib/stores/prefs.js';
	import { buildAppsFromConfig } from '$lib/apps.js';
	import { getBrandBgStyle } from '$lib/iconHelpers.js';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import TileContextMenu from '$lib/components/TileContextMenu.svelte';
	import SetupGuideModal from '$lib/components/SetupGuideModal.svelte';
	import BookmarkEditor from '$lib/components/BookmarkEditor.svelte';
	import { recordOpen } from '$lib/launcher/frecency.js';
	import { healthLine, healthLabel } from '$lib/health.js';
	import {
		CARD_SIZES,
		DEFAULT_CARD_SIZE,
		GENERAL,
		bookmarkIcon,
		bookmarkToApp,
		effectiveCardSize,
		groupBookmarks,
		groupPortalApps,
		portalCategory,
		urlHost
	} from '$lib/bookmarks.js';

	let {
		guideApp = $bindable(null),
		editMode = $bindable(false),
		searchEnabled = false,
		customizationEnabled = false,
		onSettingsOpen = () => {},
		initialBookmarks = [],
		initialCategories = []
	} = $props();

	const siteConfig = getContext('config');

	// ── Tabs ────────────────────────────────────────────────────────────────
	let activeTab = $state('bookmarks');

	function selectTab(tab) {
		activeTab = tab;
		prefs.update((p) => ({ ...p, dashboardTab: tab }));
	}

	// Server prefs arrive after hydration; follow them unless the user has
	// already clicked (in which case the click wrote the same value back).
	$effect(() => {
		const saved = $prefs.dashboardTab;
		if ((saved === 'bookmarks' || saved === 'portal') && saved !== activeTab) activeTab = saved;
	});

	const cardSize = $derived(CARD_SIZES.includes($prefs.cardSize) ? $prefs.cardSize : DEFAULT_CARD_SIZE);
	const iconStyle = $derived($prefs.iconStyle || 'colored');
	const openInNewTab = $derived($prefs.openInNewTab ?? true);

	function sizeOf(item) {
		return effectiveCardSize(item?.size, cardSize);
	}
	function portalSizeOf(app) {
		return effectiveCardSize(($prefs.portalCardSizes || {})[app.id], cardSize);
	}

	// ── Portal ──────────────────────────────────────────────────────────────
	const builtApps = $derived(buildAppsFromConfig(siteConfig?.apps));
	const setupGuides = $derived(builtApps.setupGuides);
	const portalApps = $derived(builtApps.apps);
	const clickActions = $derived(Object.fromEntries(portalApps.map((a) => [a.id, a.onClick])));

	const portalGroups = $derived(
		groupPortalApps(portalApps, {
			order: $prefs.portalCategoryOrder || [],
			overrides: $prefs.portalAppCategories || {}
		})
	);

	// ── Bookmarks ───────────────────────────────────────────────────────────
	let bookmarks = $state(untrack(() => (Array.isArray(initialBookmarks) ? [...initialBookmarks] : [])));
	let categories = $state(untrack(() => (Array.isArray(initialCategories) ? [...initialCategories] : [])));
	let apiError = $state('');
	let editorOpen = $state(false);
	let editingBookmark = $state(null);
	let editorCategory = $state('');
	let categoryEdit = $state(null);
	let addingCategory = $state(false);
	let newCategoryName = $state('');
	let savingCategory = $state(false);

	const bookmarkGroups = $derived(groupBookmarks(bookmarks, categories));
	const visibleBookmarkGroups = $derived(
		bookmarkGroups.filter((group) => group.items.length || (editMode && group.name))
	);
	const bookmarkApps = $derived(bookmarks.map(bookmarkToApp));
	const searchApps = $derived([...portalApps, ...bookmarkApps]);

	async function api(path, options = {}) {
		const res = await fetch(path, {
			headers: { 'content-type': 'application/json', ...(options.headers || {}) },
			...options
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
		return data;
	}

	async function loadBookmarks() {
		try {
			const data = await api('/api/bookmarks');
			bookmarks = data.bookmarks || [];
			categories = data.categories || [];
			apiError = '';
		} catch (err) {
			apiError = err.message || 'Could not load bookmarks';
		}
	}

	function ensureCategoryLocal(name) {
		if (!name) return;
		if (categories.some((c) => c.name === name)) return;
		categories = [...categories, { name, position: categories.length }];
	}

	function openAdd(category = '') {
		editingBookmark = null;
		editorCategory = category;
		editorOpen = true;
	}
	function openEdit(bookmark) {
		editingBookmark = bookmark;
		editorCategory = bookmark.category || '';
		editorOpen = true;
	}

	async function saveBookmark(value) {
		try {
			if (editingBookmark) {
				const data = await api(`/api/bookmarks/${editingBookmark.id}`, {
					method: 'PATCH',
					body: JSON.stringify(value)
				});
				bookmarks = bookmarks.map((b) => (b.id === editingBookmark.id ? data.bookmark : b));
			} else {
				const data = await api('/api/bookmarks', { method: 'POST', body: JSON.stringify(value) });
				bookmarks = [...bookmarks, data.bookmark];
			}
			ensureCategoryLocal(value.category);
			apiError = '';
			editorOpen = false;
		} catch (err) {
			apiError = err.message || 'Could not save bookmark';
			throw err;
		}
	}

	async function deleteBookmark(bookmark) {
		try {
			await api(`/api/bookmarks/${bookmark.id}`, { method: 'DELETE' });
			bookmarks = bookmarks.filter((b) => b.id !== bookmark.id);
			apiError = '';
			editorOpen = false;
		} catch (err) {
			apiError = err.message || 'Could not delete bookmark';
			throw err;
		}
	}

	// ── Reorder bookmarks ───────────────────────────────────────────────────
	let dragBookmarkId = $state(null);

	function beginBookmarkDrag(e, bookmark) {
		if (!editMode) return;
		dragBookmarkId = bookmark.id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			try {
				e.dataTransfer.setData('text/plain', String(bookmark.id));
			} catch {}
		}
	}
	function endBookmarkDrag() {
		dragBookmarkId = null;
	}
	function bookmarkDragOver(e) {
		if (dragBookmarkId == null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}

	async function persistOrder(next) {
		const previous = bookmarks;
		bookmarks = next;
		try {
			const data = await api('/api/bookmarks/reorder', {
				method: 'PUT',
				body: JSON.stringify({
					items: next.map((b) => ({ id: b.id, category: b.category || '' }))
				})
			});
			bookmarks = data.bookmarks || next;
			categories = (await api('/api/bookmarks/categories')).categories || categories;
			apiError = '';
		} catch (err) {
			bookmarks = previous;
			apiError = err.message || 'Could not save the new order';
		}
	}

	function moveBookmarkBefore(sourceId, targetId, category) {
		if (sourceId === targetId) return;
		const moving = bookmarks.find((b) => b.id === sourceId);
		if (!moving) return;
		const next = bookmarks.filter((b) => b.id !== sourceId);
		const moved = { ...moving, category: category || '' };
		let at = next.findIndex((b) => b.id === targetId);
		if (at < 0) at = next.length;
		next.splice(at, 0, moved);
		persistOrder(next);
	}

	function moveBookmarkToEnd(sourceId, category) {
		const moving = bookmarks.find((b) => b.id === sourceId);
		if (!moving) return;
		const next = bookmarks.filter((b) => b.id !== sourceId);
		next.push({ ...moving, category: category || '' });
		persistOrder(next);
	}

	function dropOnBookmark(e, target, category) {
		if (dragBookmarkId == null) return;
		e.preventDefault();
		e.stopPropagation();
		const id = dragBookmarkId;
		dragBookmarkId = null;
		moveBookmarkBefore(id, target.id, category);
	}

	function dropOnCategory(e, category) {
		if (dragBookmarkId == null) return;
		e.preventDefault();
		const id = dragBookmarkId;
		dragBookmarkId = null;
		moveBookmarkToEnd(id, category);
	}

	function moveWithinGroup(group, bookmark, delta) {
		const items = [...group.items];
		const i = items.findIndex((b) => b.id === bookmark.id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= items.length) return;
		[items[i], items[j]] = [items[j], items[i]];
		const next = bookmarkGroups.flatMap((g) => (g.key === group.key ? items : g.items));
		persistOrder(next);
	}

	// ── Bookmark categories ─────────────────────────────────────────────────
	function beginCategoryRename(group) {
		categoryEdit = { from: group.name, value: group.name };
	}

	async function saveCategoryRename() {
		if (!categoryEdit) return;
		const from = categoryEdit.from;
		const to = categoryEdit.value.trim();
		categoryEdit = null;
		if (!to || to === from) return;
		savingCategory = true;
		try {
			const data = await api('/api/bookmarks/categories', {
				method: 'PATCH',
				body: JSON.stringify({ from, to })
			});
			categories = data.categories || categories;
			bookmarks = bookmarks.map((b) => (b.category === from ? { ...b, category: to } : b));
			apiError = '';
		} catch (err) {
			apiError = err.message || 'Could not rename the category';
		} finally {
			savingCategory = false;
		}
	}

	async function removeCategory(group) {
		if (!group.name) return;
		if (!confirm(`Delete “${group.label}”? Its bookmarks move to Uncategorized.`)) return;
		try {
			const data = await api(`/api/bookmarks/categories?name=${encodeURIComponent(group.name)}`, {
				method: 'DELETE'
			});
			categories = data.categories || categories;
			await loadBookmarks();
		} catch (err) {
			apiError = err.message || 'Could not delete the category';
		}
	}

	async function addCategory() {
		const name = newCategoryName.trim();
		if (!name || savingCategory) return;
		savingCategory = true;
		try {
			const data = await api('/api/bookmarks/categories', {
				method: 'POST',
				body: JSON.stringify({ name })
			});
			categories = data.categories || categories;
			newCategoryName = '';
			addingCategory = false;
			apiError = '';
		} catch (err) {
			apiError = err.message || 'Could not add the category';
		} finally {
			savingCategory = false;
		}
	}

	async function moveCategory(name, delta) {
		const names = bookmarkGroups.filter((g) => g.name).map((g) => g.name);
		const i = names.indexOf(name);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= names.length) return;
		[names[i], names[j]] = [names[j], names[i]];
		const previous = categories;
		// Optimistic: reorder the category rows the same way.
		const byName = new Map(categories.map((c) => [c.name, c]));
		categories = names.filter((n) => byName.has(n)).map((n, index) => ({ ...byName.get(n), position: index }));
		try {
			const data = await api('/api/bookmarks/categories', {
				method: 'PUT',
				body: JSON.stringify({ names })
			});
			categories = data.categories || categories;
			apiError = '';
		} catch (err) {
			categories = previous;
			apiError = err.message || 'Could not reorder categories';
		}
	}

	// ── Portal order and per-app overrides ──────────────────────────────────
	let dragPortalId = $state(null);

	function beginPortalDrag(e, app) {
		if (!editMode) return;
		dragPortalId = app.id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			try {
				e.dataTransfer.setData('text/plain', app.id);
			} catch {}
		}
	}
	function endPortalDrag() {
		dragPortalId = null;
	}
	function portalDragOver(e) {
		if (dragPortalId == null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}
	function dropPortalOnCategory(e, category) {
		if (dragPortalId == null) return;
		e.preventDefault();
		const id = dragPortalId;
		dragPortalId = null;
		const app = portalApps.find((a) => a.id === id);
		if (!app) return;
		const fallback = portalCategory(app);
		const map = { ...($prefs.portalAppCategories || {}) };
		if (category === fallback) delete map[id];
		else map[id] = category;
		prefs.update((p) => ({ ...p, portalAppCategories: map }));
	}

	function movePortalCategory(name, delta) {
		const names = portalGroups.map((g) => g.name);
		const i = names.indexOf(name);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= names.length) return;
		[names[i], names[j]] = [names[j], names[i]];
		prefs.update((p) => ({ ...p, portalCategoryOrder: names }));
	}

	function cyclePortalSize(app) {
		const order = ['', 'compact', 'medium', 'wide'];
		const current = ($prefs.portalCardSizes || {})[app.id] || '';
		const next = order[(order.indexOf(current) + 1) % order.length];
		const map = { ...($prefs.portalCardSizes || {}) };
		if (next) map[app.id] = next;
		else delete map[app.id];
		prefs.update((p) => ({ ...p, portalCardSizes: map }));
	}

	function portalSizeLabel(app) {
		const own = ($prefs.portalCardSizes || {})[app.id];
		return own ? own[0].toUpperCase() : 'A';
	}

	// ── Portal links, menus and health ──────────────────────────────────────
	function recordAppOpen(appId) {
		recordOpen(`app:${appId}`);
	}

	let contextApp = $state(null);
	let contextAnchor = $state(null);

	function showContext(app, e) {
		e.preventDefault();
		e.stopPropagation();
		contextAnchor = e.currentTarget;
		contextApp = app;
	}

	function openGuide(app) {
		contextApp = null;
		guideApp = app;
	}

	function guideClickable(app) {
		return clickActions[app.id] === 'getting_started' && !!setupGuides[app.name];
	}
	function guideOnClick(app) {
		return guideClickable(app) && !($prefs.guidesDismissed || []).includes(app.id);
	}
	function dismissGuide(app, dismissed) {
		const rest = ($prefs.guidesDismissed || []).filter((id) => id !== app.id);
		prefs.update((p) => ({ ...p, guidesDismissed: dismissed ? [...rest, app.id] : rest }));
	}

	function onPortalClick(e, app) {
		if (editMode) {
			e.preventDefault();
			return;
		}
		if (!e.metaKey && !e.ctrlKey && guideOnClick(app)) {
			e.preventDefault();
			guideApp = app;
			return;
		}
		if (!e.metaKey && !e.ctrlKey && clickActions[app.id] === 'menu') {
			showContext(app, e);
			return;
		}
		recordAppOpen(app.id);
	}

	let health = $state({});
	let healthNow = $state(Date.now());
	async function loadHealth() {
		try {
			const res = await fetch('/api/health');
			if (res.ok) health = (await res.json()).apps || {};
		} catch {}
		healthNow = Date.now();
	}
	const healthOn = $derived(siteConfig?.health?.enabled && $prefs.healthDots !== false);
	$effect(() => {
		if (!healthOn) health = {};
		if (!browser || !portalApps.length || !healthOn) return;
		loadHealth();
		const soon = setTimeout(loadHealth, 5000);
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') loadHealth();
		}, 30_000);
		const onVisible = () => document.visibilityState === 'visible' && loadHealth();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearTimeout(soon);
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// ── Search ──────────────────────────────────────────────────────────────
	let searchInput = $state('');

	// Existing custom bookmarks lived in prefs; move them into SQLite once so
	// nobody loses the links they added before this layout.
	let migrationStarted = false;
	onMount(() => {
		if (!browser || migrationStarted) return;
		migrationStarted = true;
		untrack(async () => {
			const p = $prefs;
			if (p.bookmarksMigrated) return;
			const legacy = Array.isArray(p.customApps) ? p.customApps : [];
			if (!legacy.length || bookmarks.length) return;
			let created = 0;
			for (const item of legacy) {
				if (!item?.name || !item?.url) continue;
				try {
					const data = await api('/api/bookmarks', {
						method: 'POST',
						body: JSON.stringify({
							title: item.name,
							url: item.url,
							category: '',
							iconUrl: /^https?:\/\//i.test(item.icon || '') ? item.icon : ''
						})
					});
					bookmarks = [...bookmarks, data.bookmark];
					created++;
				} catch {
					// Try again next visit; the prefs flag stays unset.
				}
			}
			if (created) prefs.update((next) => ({ ...next, bookmarksMigrated: true }));
		});
	});

	// If customization is turned off, leave edit mode rather than showing
	// controls that can't be used.
	$effect(() => {
		if (!customizationEnabled && editMode) editMode = false;
	});

	if (browser && $prefs && !$prefs.dashboardTab) {
		// First visit: start where the spec puts the eye first.
		prefs.update((p) => (p.dashboardTab ? p : { ...p, dashboardTab: 'bookmarks' }));
	}
</script>

<div class="hero-area">
	{#if searchEnabled}
		<div class="hero-slot">
			<SearchBar bind:query={searchInput} apps={searchApps} {onSettingsOpen} />
		</div>
	{/if}
</div>

<div class="tab-switcher" role="tablist" aria-label="Dashboard view">
	<button
		type="button"
		role="tab"
		aria-selected={activeTab === 'bookmarks'}
		class="tab-pill"
		class:is-active={activeTab === 'bookmarks'}
		onclick={() => selectTab('bookmarks')}
	>Bookmarks</button>
	<button
		type="button"
		role="tab"
		aria-selected={activeTab === 'portal'}
		class="tab-pill"
		class:is-active={activeTab === 'portal'}
		onclick={() => selectTab('portal')}
	>Portal</button>
</div>

{#if apiError}
	<div class="dash-error" role="alert">{apiError}</div>
{/if}

{#if activeTab === 'bookmarks'}
	<div class="tab-panel" role="tabpanel" aria-label="Bookmarks">
		{#if visibleBookmarkGroups.length === 0}
			<div class="empty-state">
				<p>No bookmarks yet.</p>
				{#if customizationEnabled}
					<button type="button" class="add-chip" onclick={() => openAdd('')}>Add your first bookmark</button>
				{/if}
			</div>
		{/if}

		{#each visibleBookmarkGroups as group (group.key)}
			<section
				class="category-section"
				aria-label={group.label}
				class:is-drop-target={dragBookmarkId != null}
				ondragover={bookmarkDragOver}
				ondrop={(e) => dropOnCategory(e, group.name)}
			>
				<div class="category-head">
					<h2 class="category-title">{group.label}</h2>
					{#if categoryEdit?.from === group.name}
						<form
							class="category-rename"
							onsubmit={(e) => {
								e.preventDefault();
								saveCategoryRename();
							}}
						>
							<input
								class="category-input"
								bind:value={categoryEdit.value}
								aria-label="Category name"
							/>
							<button type="submit" class="mini-btn" disabled={savingCategory}>Save</button>
							<button type="button" class="mini-btn" onclick={() => (categoryEdit = null)}>Cancel</button>
						</form>
					{:else if editMode && group.name}
						<div class="category-actions">
							<button type="button" class="mini-btn" onclick={() => beginCategoryRename(group)} title="Rename category" aria-label="Rename {group.label}">Rename</button>
							<button type="button" class="mini-btn" onclick={() => moveCategory(group.name, -1)} title="Move category up" aria-label="Move {group.label} up">↑</button>
							<button type="button" class="mini-btn" onclick={() => moveCategory(group.name, 1)} title="Move category down" aria-label="Move {group.label} down">↓</button>
							<button type="button" class="mini-btn is-danger" onclick={() => removeCategory(group)} title="Delete category" aria-label="Delete {group.label}">Delete</button>
						</div>
					{/if}
					{#if editMode}
						<button type="button" class="mini-btn add-inline" onclick={() => openAdd(group.name)}>+ Add</button>
					{/if}
				</div>

				{#if group.items.length === 0}
					<div class="category-empty">Drop a bookmark here</div>
				{:else}
					<div class="card-grid size-{cardSize}">
						{#each group.items as bookmark (bookmark.id)}
							{@const size = sizeOf(bookmark)}
							<div
								class="card-wrap span-{size}"
								role="group"
								aria-label={bookmark.title}
								class:is-dragging={dragBookmarkId === bookmark.id}
								draggable={editMode}
								ondragstart={(e) => beginBookmarkDrag(e, bookmark)}
								ondragend={endBookmarkDrag}
								ondragover={bookmarkDragOver}
								ondrop={(e) => dropOnBookmark(e, bookmark, group.name)}
							>
								<a
									class="dash-card card-{size}"
									href={editMode ? undefined : bookmark.url}
									target={editMode ? undefined : openInNewTab ? '_blank' : undefined}
									rel={editMode ? undefined : openInNewTab ? 'noopener noreferrer' : undefined}
									title={bookmark.title}
									onclick={(e) => {
										if (editMode) {
											e.preventDefault();
											return;
										}
										recordOpen(`app:bookmark-${bookmark.id}`);
									}}
								>
									<span class="dash-icon" style={iconStyle === 'colored' ? getBrandBgStyle(bookmarkIcon(bookmark)) : ''}>
										<AppIcon icon={bookmarkIcon(bookmark)} name={bookmark.title} size="w-6 h-6" {iconStyle} />
									</span>
									<span class="dash-text">
										<span class="dash-title">{bookmark.title}</span>
										{#if size !== 'compact'}
											<span class="dash-sub">{bookmark.subtitle || urlHost(bookmark.url)}</span>
										{/if}
									</span>
								</a>
								{#if editMode}
									<div class="card-controls">
										<button type="button" class="card-btn" title="Move up" aria-label="Move {bookmark.title} up" onclick={() => moveWithinGroup(group, bookmark, -1)}>↑</button>
										<button type="button" class="card-btn" title="Move down" aria-label="Move {bookmark.title} down" onclick={() => moveWithinGroup(group, bookmark, 1)}>↓</button>
										<button type="button" class="card-btn" title="Edit" aria-label="Edit {bookmark.title}" onclick={() => openEdit(bookmark)}>✎</button>
										<button type="button" class="card-btn is-danger" title="Delete" aria-label="Delete {bookmark.title}" onclick={() => deleteBookmark(bookmark)}>×</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/each}

		{#if editMode}
			<div class="bookmark-admin">
				{#if addingCategory}
					<form
						class="category-rename"
						onsubmit={(e) => {
							e.preventDefault();
							addCategory();
						}}
					>
						<input
							class="category-input"
							bind:value={newCategoryName}
							placeholder="New category"
							aria-label="New category name"
						/>
						<button type="submit" class="mini-btn" disabled={savingCategory}>Add</button>
						<button type="button" class="mini-btn" onclick={() => (addingCategory = false)}>Cancel</button>
					</form>
				{:else}
					<button type="button" class="add-chip" onclick={() => (addingCategory = true)}>New category</button>
					<button type="button" class="add-chip" onclick={() => openAdd('')}>Add bookmark</button>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<div class="tab-panel" role="tabpanel" aria-label="Portal">
		{#if portalGroups.length === 0}
			<div class="empty-state"><p>No apps are configured for your account.</p></div>
		{/if}

		{#each portalGroups as group (group.key)}
			<section
				class="category-section"
				aria-label={group.label}
				class:is-drop-target={dragPortalId != null}
				ondragover={portalDragOver}
				ondrop={(e) => dropPortalOnCategory(e, group.name)}
			>
				<div class="category-head">
					<h2 class="category-title">{group.label}</h2>
					{#if editMode}
						<div class="category-actions">
							<button type="button" class="mini-btn" onclick={() => movePortalCategory(group.name, -1)} title="Move category up" aria-label="Move {group.label} up">↑</button>
							<button type="button" class="mini-btn" onclick={() => movePortalCategory(group.name, 1)} title="Move category down" aria-label="Move {group.label} down">↓</button>
						</div>
					{/if}
				</div>
				<div class="card-grid size-{cardSize}">
					{#each group.items as app (app.id)}
						{@const size = portalSizeOf(app)}
						{@const healthEntry = healthLine(app, health[app.id], healthNow)}
						<div
							class="card-wrap span-{size}"
							role="group"
							aria-label={app.name}
							class:is-dragging={dragPortalId === app.id}
							draggable={editMode}
							ondragstart={(e) => beginPortalDrag(e, app)}
							ondragend={endPortalDrag}
						>
							<a
								class="dash-card card-{size}"
								class:health-faded={health[app.id]?.state === 'down'}
								href={editMode ? undefined : app.url}
								target={editMode ? undefined : openInNewTab ? '_blank' : undefined}
								rel={editMode ? undefined : openInNewTab ? 'noopener noreferrer' : undefined}
								title={healthEntry ? undefined : app.name}
								aria-label={healthLabel(app, health[app.id])}
								onclick={(e) => onPortalClick(e, app)}
								oncontextmenu={editMode ? undefined : (e) => showContext(app, e)}
							>
								<span class="dash-icon" style={iconStyle === 'colored' ? getBrandBgStyle(app.icon) : ''}>
									<AppIcon icon={app.icon} name={app.name} size="w-6 h-6" {iconStyle} />
									{#if healthEntry}
										<span class="health-dot health-{healthEntry.tone}" aria-hidden="true"></span>
									{/if}
								</span>
								<span class="dash-text">
									<span class="dash-title">{app.name}</span>
									{#if size !== 'compact'}
										<span class="dash-sub">{app.subtitle || urlHost(app.url)}</span>
									{/if}
								</span>
							</a>
							{#if editMode}
								<div class="card-controls">
									<button
										type="button"
										class="card-btn size-btn"
										title="Cycle card size"
										aria-label="Card size for {app.name}: {portalSizeLabel(app)}"
										onclick={() => cyclePortalSize(app)}
										onpointerdown={(e) => e.stopPropagation()}
									>{portalSizeLabel(app)}</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}

{#if customizationEnabled}
	{#if editMode}
		<div class="edit-hint" role="status">
			Drag cards to reorder · drop on a category to move them · Configure sets the card size
		</div>
	{:else}
		<div class="surface-footer">
			<button type="button" class="edit-chip" onclick={() => (editMode = true)} aria-label="Edit layout" title="Edit layout">Edit</button>
		</div>
	{/if}
{/if}

{#if contextApp}
	<TileContextMenu
		app={contextApp}
		anchor={contextAnchor}
		hasGuide={!!setupGuides[contextApp.name]}
		health={healthLine(contextApp, health[contextApp.id], healthNow)}
		onopen={(app) => recordAppOpen(app.id)}
		onguide={openGuide}
		onclose={() => (contextApp = null)}
	/>
{/if}

{#if guideApp && setupGuides[guideApp.name]}
	<SetupGuideModal
		app={guideApp}
		guide={setupGuides[guideApp.name]}
		{iconStyle}
		dismissible={guideClickable(guideApp)}
		{openInNewTab}
		dismissed={($prefs.guidesDismissed || []).includes(guideApp.id)}
		ondismiss={(d) => dismissGuide(guideApp, d)}
		onopenapp={() => recordAppOpen(guideApp.id)}
		onclose={() => (guideApp = null)}
	/>
{/if}

<BookmarkEditor
	bind:open={editorOpen}
	bookmark={editingBookmark}
	{categories}
	defaultCategory={editorCategory}
	onsave={saveBookmark}
	ondelete={deleteBookmark}
/>

<style>
	.hero-area {
		padding: 1rem 0 1rem;
	}
	.hero-slot {
		min-height: 3rem;
	}

	/* Centered pill switcher below the search bar. */
	.tab-switcher {
		display: flex;
		justify-content: center;
		gap: 0.25rem;
		margin: 0 auto 1.75rem;
		padding: 0.25rem;
		width: fit-content;
		border-radius: 9999px;
		border: 1px solid var(--glass-border);
		background: var(--input-bg);
	}
	.tab-pill {
		border: none;
		background: transparent;
		color: var(--text-dim);
		font: inherit;
		font-size: 0.76rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		padding: 0.42rem 1.15rem;
		border-radius: 9999px;
		cursor: pointer;
		transition: background 160ms ease, color 160ms ease;
	}
	.tab-pill:hover {
		color: var(--text);
	}
	.tab-pill.is-active {
		background: var(--surface-card-strong, rgba(255, 255, 255, 0.1));
		color: var(--text);
	}

	.dash-error {
		margin: 0 auto 1rem;
		max-width: 640px;
		padding: 0.55rem 0.8rem;
		border-radius: 0.6rem;
		font-size: 0.74rem;
		color: #fecaca;
		background: rgba(220, 38, 38, 0.16);
		border: 1px solid rgba(220, 38, 38, 0.35);
	}
	:global(.theme-light) .dash-error {
		color: #991b1b;
		background: rgba(220, 38, 38, 0.08);
	}

	.tab-panel {
		display: flex;
		flex-direction: column;
		gap: 1.9rem;
		padding-bottom: 0.5rem;
	}

	.category-section {
		border-radius: 0.8rem;
		transition: background 160ms ease, box-shadow 160ms ease;
	}
	.category-section.is-drop-target {
		background: rgba(255, 255, 255, 0.025);
		box-shadow: 0 0 0 1px var(--glass-border);
	}
	:global(.theme-light) .category-section.is-drop-target {
		background: rgba(0, 0, 0, 0.02);
	}
	.category-head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
		min-height: 1.7rem;
		margin-bottom: 0.7rem;
		padding: 0 0.15rem;
	}
	.category-title {
		margin: 0;
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.19em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	.category-actions {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}
	.add-inline {
		margin-left: auto;
	}
	.mini-btn {
		font: inherit;
		font-size: 0.65rem;
		line-height: 1;
		padding: 0.28rem 0.45rem;
		border-radius: 9999px;
		border: 1px solid var(--glass-border);
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
		transition: color 150ms ease, border-color 150ms ease, background 150ms ease;
	}
	.mini-btn:hover {
		color: var(--text);
		border-color: var(--text-dim);
		background: var(--input-bg);
	}
	.mini-btn.is-danger:hover {
		color: #fca5a5;
		border-color: rgba(248, 113, 113, 0.5);
	}
	.mini-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.category-rename {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.category-input {
		font: inherit;
		font-size: 0.72rem;
		padding: 0.28rem 0.5rem;
		border-radius: 0.45rem;
		border: 1px solid var(--glass-border);
		background: var(--input-bg);
		color: var(--text);
		outline: none;
		min-width: 10rem;
	}
	.category-input:focus {
		border-color: var(--text-dim);
	}
	.category-empty {
		font-size: 0.68rem;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		padding: 0.85rem;
		border: 1px dashed var(--glass-border);
		border-radius: 0.65rem;
		text-align: center;
	}

	/* Responsive multi-column grids, three densities. */
	.card-grid {
		display: grid;
		gap: 0.65rem;
	}
	.card-grid.size-compact {
		grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
	}
	.card-grid.size-medium {
		grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
	}
	.card-grid.size-wide {
		grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
	}
	.card-wrap {
		position: relative;
		min-width: 0;
	}
	.card-wrap.span-wide {
		grid-column: span 2;
	}
	@media (max-width: 520px) {
		.card-wrap.span-wide {
			grid-column: span 1;
		}
	}
	.card-wrap.is-dragging {
		opacity: 0.45;
	}

	.dash-card {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		height: 100%;
		min-height: 58px;
		padding: 0.65rem 0.7rem;
		border: 1px solid transparent;
		border-radius: 0.75rem;
		text-decoration: none;
		color: var(--text);
		background: var(--card-bg, transparent);
		transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
		-webkit-user-select: none;
		user-select: none;
	}
	.dash-card:hover {
		background: var(--input-bg);
		border-color: var(--glass-border);
	}
	.dash-card.health-faded {
		opacity: 0.55;
	}
	.dash-card.card-compact {
		flex-direction: column;
		justify-content: center;
		text-align: center;
		gap: 0.35rem;
		padding: 0.7rem 0.3rem;
		min-height: 84px;
	}
	.dash-card.card-compact .dash-text {
		width: 100%;
	}
	.dash-card.card-compact .dash-title {
		font-size: 0.68rem;
		text-align: center;
	}
	.dash-card.card-wide {
		gap: 0.95rem;
		padding: 0.85rem 0.95rem;
		min-height: 82px;
	}
	.dash-card.card-wide .dash-icon {
		width: 48px;
		height: 48px;
		border-radius: 13px;
	}
	.dash-icon {
		position: relative;
		width: 38px;
		height: 38px;
		border-radius: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		overflow: visible;
		background: var(--tile-bg-default, rgba(255, 255, 255, 0.06));
	}
	.dash-icon :global(img) {
		max-width: 24px;
		max-height: 24px;
		object-fit: contain;
	}
	.dash-card.card-wide .dash-icon :global(img) {
		max-width: 30px;
		max-height: 30px;
	}
	.dash-text {
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
		min-width: 0;
		flex: 1;
	}
	.dash-title {
		font-size: 0.76rem;
		font-weight: 500;
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.dash-sub {
		font-size: 0.65rem;
		line-height: 1.3;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dash-card.card-wide .dash-title {
		font-size: 0.83rem;
	}

	.health-dot {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--health-ring, rgba(20, 20, 22, 0.85));
		pointer-events: none;
	}
	:global(body.theme-light) .health-dot {
		--health-ring: #fff;
	}
	.health-dot.health-down {
		background: #ef4444;
	}
	.health-dot.health-slow {
		background: #f59e0b;
	}
	.health-dot.health-failed {
		background: transparent;
		box-shadow: inset 0 0 0 2px #a1a1aa, 0 0 0 2px var(--health-ring, rgba(20, 20, 22, 0.85));
	}

	.card-controls {
		position: absolute;
		top: 2px;
		right: 2px;
		display: flex;
		gap: 2px;
		opacity: 0;
		transition: opacity 140ms ease;
		z-index: 4;
	}
	.card-wrap:hover .card-controls,
	.card-wrap:focus-within .card-controls {
		opacity: 1;
	}
	@media (pointer: coarse) {
		.card-controls {
			opacity: 1;
		}
	}
	.card-btn {
		font: inherit;
		font-size: 0.68rem;
		line-height: 1;
		width: 21px;
		height: 21px;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid var(--glass-border);
		background: var(--surface-card-strong, rgba(20, 20, 22, 0.8));
		color: var(--text-muted);
		cursor: pointer;
	}
	.card-btn:hover {
		color: var(--text);
	}
	.card-btn.is-danger:hover {
		color: #fca5a5;
		border-color: rgba(248, 113, 113, 0.5);
	}
	.card-btn.size-btn {
		width: auto;
		padding: 0 0.35rem;
		font-size: 0.58rem;
		letter-spacing: 0.06em;
	}

	.empty-state {
		text-align: center;
		padding: 2.5rem 1rem;
		color: var(--text-dim);
		font-size: 0.78rem;
	}
	.empty-state p {
		margin: 0 0 0.9rem;
	}
	.add-chip {
		font: inherit;
		font-size: 0.7rem;
		padding: 0.35rem 0.75rem;
		border-radius: 9999px;
		border: 1px dashed var(--glass-border);
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
	}
	.add-chip:hover {
		color: var(--text);
		border-style: solid;
		border-color: var(--text-dim);
	}
	.bookmark-admin {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		flex-wrap: wrap;
		padding-top: 0.25rem;
	}

	.surface-footer {
		display: flex;
		justify-content: center;
		margin-top: 1.25rem;
		margin-bottom: 1rem;
	}
	.edit-chip {
		font-size: 0.7rem;
		letter-spacing: 0.06em;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text-dim);
		opacity: 0.85;
		cursor: pointer;
		transition: background 180ms ease, border-color 180ms ease, color 180ms ease;
	}
	.edit-chip:hover,
	.edit-chip:focus-visible {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.28);
		color: var(--text);
		opacity: 1;
		outline: none;
	}
	:global(.theme-light) .edit-chip {
		border-color: rgba(0, 0, 0, 0.14);
	}
	:global(.theme-light) .edit-chip:hover {
		background: rgba(0, 0, 0, 0.05);
		border-color: rgba(0, 0, 0, 0.3);
	}
	.edit-hint {
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		color: var(--text-dim);
		opacity: 0.7;
		text-align: center;
		margin-top: 1rem;
		margin-bottom: 1rem;
	}

	/* The search palette dims the rest of the page; these blocks are part of
	   the dashboard and should step back with it. */
	:global(body.search-active) .tab-switcher,
	:global(body.search-active) .tab-panel,
	:global(body.search-active) .surface-footer,
	:global(body.search-active) .edit-hint {
		opacity: 0.25;
		filter: blur(1.5px);
		pointer-events: none;
		transition: opacity 180ms ease-out, filter 180ms ease-out;
	}
</style>
