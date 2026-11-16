<script>
	import { dialog } from '$lib/actions/dialog.js';
	import { portal } from '$lib/actions/portal.js';
	import { getContext } from 'svelte';
	import { prefs } from '$lib/stores/prefs.js';
	import { buildAppsFromConfig, resolveIcon } from '$lib/apps.js';
	import IntegrationsPanel from '$lib/components/IntegrationsPanel.svelte';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import { integrations as integrationsStore } from '$lib/stores/integrations.js';
	import { getWallpaperThumbUrl } from '$lib/wallpaper.js';
	import { browser } from '$app/environment';
	import { confirmDiscardUnsaved } from '$lib/unsaved.js';
	import { DEFAULT_TIME_FORMAT, DEFAULT_TEMP_UNIT, TIME_FORMATS, TEMP_UNITS } from '$lib/units.js';
	import UnitPicker from '$lib/components/UnitPicker.svelte';
	import { SEARCH_ON_FOCUS, searchOnFocus } from '$lib/searchOnFocus.js';
	import { SEARCH_TRANSPARENCY, SEARCH_HINTS, searchTransparency, searchHints } from '$lib/searchLook.js';
	import { SEARCH_ENGINES, effectiveSearchEngine } from '$lib/searchEngine.js';
	import { DEFAULT_CARD_SIZE } from '$lib/bookmarks.js';
	import ConfigManager from '$lib/components/ConfigManager.svelte';

	const siteConfig = getContext('config');
	const version = siteConfig?.version || '';
	// The version is Holm's whatever the branding says, and links to its repo.
	// A newer release, when update_check found one and lets this user see it.
	const update = siteConfig?.update || null;
	// Injected by vite.config.js from package.json's repository.url, so a
	// fork's version link points at the fork.
	const REPO_URL = __HOLM_REPO_URL__;
	// Off when database.enabled is false: credentials would have nowhere to live.
	const integrationsEnabled = siteConfig?.integrations?.enabled !== false;
	// The user-facing settings (General, Appearance, Widgets) need the
	// customization switch. The Config tab is separate: it is for the fixed
	// "admins" OIDC group and works even when customization is off.
	const customizationEnabled = siteConfig?.customization?.enabled === true;
	const adminEnabled = siteConfig?.admin?.enabled === true;
	const { apps: catalogApps } = buildAppsFromConfig(siteConfig?.apps);

	const defaultAppIds = catalogApps.filter((a) => a.default !== false).map((a) => a.id);
	// Services is only offered as a landing tab when the user can see one.
	const hasServices = catalogApps.some((app) => app.service);
	function landingPref(value) {
		return value === 'services' && !hasServices ? 'last' : value || 'last';
	}

	let { open = $bindable(false) } = $props();

	let activeTab = $state('appearance');
	// ConfigManager reports its draft state so the modal header can offer the
	// persistent Save Config button while there is something to write.
	let configManager = $state(null);
	let configState = $state(null);
	let visibleSet = $state(new Set($prefs.visibleApps || defaultAppIds));
	let iconStyle = $state($prefs.iconStyle || 'colored');
	let theme = $state($prefs.theme || 'auto');
	let wallpaperEnabled = $state($prefs.wallpaperEnabled !== false);
	let wallpaperId = $state($prefs.wallpaperId || null);
	let openInNewTab = $state($prefs.openInNewTab ?? false);
	let defaultLandingTab = $state(landingPref($prefs.defaultLandingTab));
	let searchEngine = $state($prefs.searchEngine || 'default');
	let searchEngineUrl = $state($prefs.searchEngineUrl || '');
	let searchEngineParam = $state($prefs.searchEngineParam || 'q');
	let searchEngineName = $state($prefs.searchEngineName || '');
	let searchEngineIcon = $state($prefs.searchEngineIcon || '');
	let cardSize = $state($prefs.cardSize || DEFAULT_CARD_SIZE);
	let containerWidth = $state($prefs.containerWidth || 'wide');
	let textScale = $state($prefs.textScale ?? 100);
	let particlesEnabled = $state($prefs.particlesEnabled === true);
	let particlesInteractive = $state($prefs.particlesInteractive !== false);
	let wallpaperPage = $state(0);
	let enabledWidgets = $state(new Set($prefs.enabledWidgets || ['weather', 'search']));
	const WALLPAPERS_PER_PAGE = 12;
	const wallpaperCount = siteConfig?.wallpapers?.count || 0;
	const totalPages = Math.max(1, Math.ceil(wallpaperCount / WALLPAPERS_PER_PAGE));

	let prevOpen = false;

	function loadFromPrefs() {
		visibleSet = new Set($prefs.visibleApps || defaultAppIds);
		iconStyle = $prefs.iconStyle || 'colored';
		theme = $prefs.theme || 'auto';
		wallpaperEnabled = $prefs.wallpaperEnabled !== false;
		wallpaperId = $prefs.wallpaperId || null;
		openInNewTab = $prefs.openInNewTab ?? false;
		defaultLandingTab = landingPref($prefs.defaultLandingTab);
		searchEngine = $prefs.searchEngine || 'default';
		searchEngineUrl = $prefs.searchEngineUrl || '';
		searchEngineParam = $prefs.searchEngineParam || 'q';
		searchEngineName = $prefs.searchEngineName || '';
		searchEngineIcon = $prefs.searchEngineIcon || '';
		cardSize = $prefs.cardSize || DEFAULT_CARD_SIZE;
		containerWidth = $prefs.containerWidth || 'wide';
		textScale = $prefs.textScale ?? 100;
		particlesEnabled = $prefs.particlesEnabled === true;
		particlesInteractive = $prefs.particlesInteractive !== false;
		wallpaperPage = wallpaperId ? Math.floor((wallpaperId - 1) / WALLPAPERS_PER_PAGE) : 0;
		enabledWidgets = new Set($prefs.enabledWidgets || ['weather', 'search']);
		healthDots = $prefs.healthDots !== false;
	}
	$effect(() => {
		if (open && !prevOpen) {
			activeTab = firstTab;
			configState = null;
			loadFromPrefs();
		}
		prevOpen = open;
	});

	// Every close path goes through here so unsaved integration edits
	// (marked data-unsaved by IntegrationCard) aren't dropped silently.
	function requestClose() {
		if (!confirmDiscardUnsaved()) return;
		open = false;
	}

	// Stable so ConfigManager's state effect doesn't loop through a fresh
	// callback identity on every parent render.
	function handleConfigState(state) {
		configState = state;
	}

	// Switching tabs unmounts the integrations panel, so it asks too.
	function selectTab(id) {
		if (id !== activeTab && !confirmDiscardUnsaved()) return;
		if (id !== 'config') configState = null;
		activeTab = id;
	}

	// Close on Escape while the modal is open
	$effect(() => {
		if (!browser || !open) return;
		function onKey(e) {
			if (e.key === 'Escape') {
				e.preventDefault();
				requestClose();
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});


	function toggle(appId) {
		const next = new Set(visibleSet);
		if (next.has(appId)) next.delete(appId);
		else next.add(appId);
		visibleSet = next;
		prefs.update(p => ({ ...p, visibleApps: [...next] }));
	}

	function setIconStyle(style) {
		iconStyle = style;
		prefs.update(p => ({ ...p, iconStyle: style }));
	}

	function setTheme(t) {
		theme = t;
		prefs.update(p => ({ ...p, theme: t }));
	}

	function setGlass(level) {
		prefs.update(p => ({ ...p, glass: level }));
	}

	function toggleWallpaper() {
		wallpaperEnabled = !wallpaperEnabled;
		prefs.update(p => ({ ...p, wallpaperEnabled }));
	}

	function toggleOpenInNewTab() {
		openInNewTab = !openInNewTab;
		prefs.update(p => ({ ...p, openInNewTab }));
	}

	function setDefaultLandingTab(tab) {
		defaultLandingTab = tab;
		prefs.update(p => ({ ...p, defaultLandingTab: tab }));
	}

	function setSearchEngine(id) {
		searchEngine = id;
		prefs.update(p => ({ ...p, searchEngine: id }));
	}

	// Custom engine fields save as they are typed; prefs debounces the write,
	// so a URL typed a character at a time still lands as one update.
	function setSearchEngineField(field, value) {
		if (field === 'url') searchEngineUrl = value;
		else if (field === 'param') searchEngineParam = value;
		else if (field === 'name') searchEngineName = value;
		else if (field === 'icon') searchEngineIcon = value;
		prefs.update(p => ({ ...p, [`searchEngine${field[0].toUpperCase()}${field.slice(1)}`]: value }));
	}

	function resetSearchEngine() {
		searchEngine = 'default';
		searchEngineUrl = '';
		searchEngineParam = 'q';
		searchEngineName = '';
		searchEngineIcon = '';
		prefs.update(p => ({ ...p, searchEngine: 'default', searchEngineUrl: '', searchEngineParam: 'q', searchEngineName: '', searchEngineIcon: '' }));
	}

	// What the bar will actually use: the pick, the custom entry, or the
	// server's search: fallback, so the summary never lies about the target.
	const currentEngine = $derived(
		effectiveSearchEngine(
			{ searchEngine, searchEngineUrl, searchEngineParam, searchEngineName, searchEngineIcon },
			siteConfig?.search
		)
	);

	function setCardSize(size) {
		cardSize = size;
		prefs.update(p => ({ ...p, cardSize: size }));
	}

	function setContainerWidth(width) {
		containerWidth = width;
		prefs.update(p => ({ ...p, containerWidth: width }));
	}

	function setTextScale(value) {
		// The slider is 85–130 in fives; clamp anyway so a stale/hand-edited
		// pref can't blow the page up.
		const scale = Math.min(130, Math.max(85, Math.round(Number(value) / 5) * 5));
		textScale = scale;
		prefs.update(p => ({ ...p, textScale: scale }));
	}

	function toggleParticles() {
		particlesEnabled = !particlesEnabled;
		prefs.update(p => ({ ...p, particlesEnabled }));
	}

	function toggleParticlesInteractive() {
		particlesInteractive = !particlesInteractive;
		prefs.update(p => ({ ...p, particlesInteractive }));
	}

	// App status is on unless switched off, so it has its own pref rather than
	// a place in enabledWidgets (which lists what's on).
	let healthDots = $state($prefs.healthDots !== false);
	function toggleHealthDots() {
		healthDots = !healthDots;
		prefs.update(p => ({ ...p, healthDots }));
	}

	function toggleWidget(id) {
		const next = new Set(enabledWidgets);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		enabledWidgets = next;
		prefs.update(p => ({ ...p, enabledWidgets: [...next] }));
	}

	// Connected integrations that bring widgets (Calendar, Music) get a row
	// here too, flipping the same switch as their card under Integrations.
	const integrationWidgets = $derived(
		integrationsEnabled
			? $integrationsStore.integrations.filter(
					(it) => it.userState?.connected && (it.availableSurfaces || []).includes('widgets') && it.widgets?.length > 0
				)
			: []
	);
	let widgetSaveError = $state('');
	// Integration id → the value being saved: the row flips at once, like the
	// card, and ignores clicks until the save lands.
	let widgetPending = $state({});

	$effect(() => {
		if (open && activeTab === 'widgets' && integrationsEnabled) integrationsStore.load();
	});

	async function toggleIntegrationWidgets(it) {
		if (it.id in widgetPending) return;
		const widgets = it.userState.surfaces?.widgets !== true;
		widgetPending = { ...widgetPending, [it.id]: widgets };
		widgetSaveError = '';
		try {
			await integrationsStore.save(it.id, {
				config: it.userState.config,
				surfaces: { ...it.userState.surfaces, widgets }
			});
		} catch (err) {
			widgetSaveError = err.message || 'Failed to update widgets';
		} finally {
			const { [it.id]: _, ...rest } = widgetPending;
			widgetPending = rest;
		}
	}

	function selectWallpaper(id) {
		wallpaperId = id;
		prefs.update(p => ({ ...p, wallpaperId: id }));
	}

	// Reset puts this panel back to its defaults: bookmarks (customApps) and
	// the tile layout are left alone. The button offers Undo for a few seconds.
	const RESET_KEYS = ['visibleApps', 'iconStyle', 'theme', 'glass', 'wallpaperEnabled', 'wallpaperId', 'openInNewTab', 'defaultLandingTab', 'searchEngine', 'searchEngineUrl', 'searchEngineParam', 'searchEngineName', 'searchEngineIcon', 'cardSize', 'containerWidth', 'textScale', 'particlesEnabled', 'particlesStyle', 'particlesInteractive'];
	let resetUndo = $state(null);
	let resetUndoTimer;

	function resetDefaults() {
		resetUndo = Object.fromEntries(RESET_KEYS.map((k) => [k, $prefs[k]]));
		clearTimeout(resetUndoTimer);
		resetUndoTimer = setTimeout(() => (resetUndo = null), 8000);
		prefs.update(p => ({ ...p, visibleApps: null, iconStyle: 'colored', theme: 'auto', glass: 'frosted', wallpaperEnabled: true, wallpaperId: null, openInNewTab: false, defaultLandingTab: 'last', searchEngine: 'default', searchEngineUrl: '', searchEngineParam: 'q', searchEngineName: '', searchEngineIcon: '', cardSize: DEFAULT_CARD_SIZE, containerWidth: 'wide', textScale: 100, particlesEnabled: false, particlesStyle: 'constellation', particlesInteractive: true }));
		loadFromPrefs();
	}

	function undoResetDefaults() {
		const snapshot = resetUndo;
		resetUndo = null;
		clearTimeout(resetUndoTimer);
		if (!snapshot) return;
		prefs.update(p => ({ ...p, ...snapshot }));
		loadFromPrefs();
	}

	const iconStyles = [
		{ id: 'colored', label: 'Colored' },
		{ id: 'white', label: 'White' },
		{ id: 'grayed', label: 'Grayed' }
	];

	const cardSizes = [
		{ id: 'compact', label: 'Compact' },
		{ id: 'medium', label: 'Medium' },
		{ id: 'wide', label: 'Wide' }
	];

	const layoutWidths = [
		{ id: 'standard', label: 'Standard' },
		{ id: 'wide', label: 'Wide' },
		{ id: 'full', label: 'Full' }
	];

	const landingTabs = [
		{ id: 'bookmarks', label: 'Bookmarks' },
		{ id: 'portal', label: 'Portal' },
		...(hasServices ? [{ id: 'services', label: 'Services' }] : []),
		{ id: 'last', label: 'Last Active' }
	];

	const glassLevels = [
		{ id: 'clear', label: 'Clear' },
		{ id: 'frosted', label: 'Frosted' },
		{ id: 'solid', label: 'Solid' }
	];

	const themes = [
		{ id: 'auto', label: 'Dynamic', dot: 'conic-gradient(from 210deg, #f5b942, #a855f7, #38bdf8, #f5b942)' },
		{ id: 'dark', label: 'Dark', dot: '#3f3f46' },
		{ id: 'light', label: 'Light', dot: '#fafafa' },
		{ id: 'obsidian', label: 'Obsidian', dot: '#d9b26f' },
		{ id: 'amethyst', label: 'Amethyst', dot: '#a855f7' },
		{ id: 'oled', label: 'OLED Velvet', dot: '#c084fc' },
		{ id: 'tokyo', label: 'Tokyo Night', dot: '#7aa2f7' },
		{ id: 'emerald', label: 'Emerald Noir', dot: '#10b981' }
	];

	const particleStyles = [
		{ id: 'constellation', label: 'Constellation' },
		{ id: 'dust', label: 'Floating Dust' },
		{ id: 'starfield', label: 'Starfield' }
	];

	// One list for both the desktop sidebar and the mobile tab strip. Config
	// is last and only appears for admins; the user tabs need customization.
	const tabs = $derived([
		...(customizationEnabled
			? [
					{ id: 'general', label: 'General', svg: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>' },
					{ id: 'appearance', label: 'Appearance', svg: '<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v-2M4.22 4.22l1.42 1.42m12.72 12.72-1.42-1.42M1 12h2m18 0h-2M4.22 19.78l1.42-1.42M18.36 5.64l-1.42 1.42"/>' },
					{ id: 'widgets', label: 'Widgets', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>' },
					...(integrationsEnabled
						? [{ id: 'integrations', label: 'Integrations', svg: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M12 17v5"/><path d="M5 8h14a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-3a2 2 0 0 1 2-2z"/>' }]
						: [])
				]
			: []),
		...(adminEnabled
			? [{ id: 'config', label: 'Config', svg: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="17" r="2" fill="currentColor" stroke="none"/>' }]
			: [])
	]);
	const firstTab = customizationEnabled ? 'appearance' : adminEnabled ? 'config' : 'general';

</script>

{#snippet versionLinks()}
	<a class="version-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" title="Holm on GitHub">Holm v{version}</a>
	{#if update}
		<a class="version-link update" href={update.url} target="_blank" rel="noopener noreferrer" title="What's in Holm v{update.latest}">v{update.latest} available</a>
	{/if}
{/snippet}

{#if open}
	<div
		use:portal
		use:dialog={{ label: 'Configure', onclose: requestClose }}
		class="fixed inset-0 modal-veil flex items-center justify-center z-[100] p-4"
	>
		<div
			class="configure-card glass-card rounded-2xl w-[96vw] h-[92vh] md:w-[92vw] md:max-w-[1400px] md:h-[86vh] md:max-h-[900px] max-md:rounded-xl overflow-hidden animate-modal-enter shadow-theme relative flex flex-col"
		>
			<!-- Header strip -->
			<div class="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-border-card">
				<div class="flex items-center gap-2.5 min-w-0">
					<span class="text-[0.82rem] font-semibold text-content">Configure</span>
					{#if activeTab === 'config' && configState?.hasChanges}
						<span class="text-[0.6rem] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-surface-input text-content-dim border border-border-card">Unsaved</span>
					{/if}
				</div>
				<div class="flex items-center gap-2 shrink-0">
					{#if activeTab === 'config' && configState?.hasChanges}
						<button
							type="button"
							class="px-3 py-1.5 rounded-lg border border-border-card bg-surface-input text-content text-[0.72rem] font-medium cursor-pointer hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
							disabled={!configState?.canSave}
							onclick={() => configManager?.saveConfig()}
						>
							{configState?.saving ? 'Saving…' : 'Save Config'}
						</button>
					{/if}
					<button
						class="bg-transparent border-none text-content-dim text-2xl cursor-pointer leading-none hover:text-content w-6 h-6 flex items-center justify-center"
						onclick={requestClose}
						aria-label="Close"
					>&times;</button>
				</div>
			</div>

			<!-- Mobile: horizontal tabs -->
			<div class="hidden max-md:flex shrink-0 px-3 pt-2 pb-1 gap-1 border-b border-border-card overflow-x-auto items-center">
				{#each tabs as tab (tab.id)}
					<button
						class="flex-1 min-w-fit px-2.5 py-2.5 rounded-lg border-none cursor-pointer text-center text-[0.75rem] font-medium transition-all duration-150 {activeTab === tab.id ? 'bg-surface-card-strong text-content' : 'bg-transparent text-content-dim'}"
						onclick={() => selectTab(tab.id)}
					>{tab.label}</button>
				{/each}
			</div>

			<!-- Tabbed layout: sidebar (desktop) + content -->
			<div class="flex flex-1 min-h-0">
				<!-- Sidebar — hidden on mobile -->
				<div class="w-56 shrink-0 px-3 pt-4 pb-3 flex flex-col max-md:hidden">
					<div class="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-content-dim px-3 pb-2">Settings</div>
					<div class="flex flex-col gap-0.5">
						{#each tabs as tab (tab.id)}
							<button
								class="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border-none cursor-pointer transition-all duration-150 text-left {activeTab === tab.id ? 'bg-surface-card-strong' : 'bg-transparent hover:bg-surface-card-hover'}"
								onclick={() => selectTab(tab.id)}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 shrink-0 {activeTab === tab.id ? 'text-content' : 'text-content-dim'}">{@html tab.svg}</svg>
								<span class="text-[0.78rem] font-medium {activeTab === tab.id ? 'text-content' : 'text-content-dim'}">{tab.label}</span>
							</button>
						{/each}
					</div>
					<div class="mt-auto pt-3">
						{#if customizationEnabled}
							{#if resetUndo}
								<button
									class="text-[0.7rem] text-content bg-transparent border-none cursor-pointer underline underline-offset-2 font-mono px-3"
									onclick={undoResetDefaults}
								>Undo reset</button>
							{:else}
								<button
									class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono px-3"
									onclick={resetDefaults}
								>Reset defaults</button>
							{/if}
						{/if}
						{#if version}
							<div class="version-line mt-1.5">{@render versionLinks()}</div>
						{/if}
					</div>
				</div>

				<!-- Tab content -->
				<div class="flex flex-1 min-h-0 min-w-0 flex-col max-md:border-l-0 border-l border-border-card {activeTab === 'config' ? 'overflow-hidden p-0' : 'overflow-y-auto px-5 max-md:px-4 pt-3 pb-4'}">
				<div class="{activeTab === 'config' ? 'flex flex-1 min-h-0 flex-col' : 'mx-auto w-full max-w-4xl'}">

				{#if activeTab === 'general'}
				<!-- ═══ GENERAL TAB ═══ -->
				<header class="tab-head">
					<div class="tab-title">General</div>
					<div class="tab-sub">How the dashboard behaves and searches the web.</div>
				</header>

				<div class="settings">
					<section class="settings-section">
						<div class="settings-section-head">Startup</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Default landing tab</div>
								<div class="setting-hint">“Last Active” opens on whichever tab you used last; the others always start there.</div>
							</div>
							<div class="setting-control wrap">
								<div class="segmented" role="radiogroup" aria-label="Default landing tab">
									{#each landingTabs as tab}
										<button
											type="button"
											role="radio"
											aria-checked={defaultLandingTab === tab.id}
											class="segmented-item"
											onclick={() => setDefaultLandingTab(tab.id)}
										>{tab.label}</button>
									{/each}
								</div>
							</div>
						</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Open apps in new tab</div>
								<div class="setting-hint">Tiles and search results open in a new browser tab.</div>
							</div>
							<div class="setting-control">
								<button class="bg-transparent border-none cursor-pointer p-0" role="switch" aria-checked={openInNewTab} aria-label="Open apps in new tab" onclick={toggleOpenInNewTab}>
									<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {openInNewTab ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
										<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {openInNewTab ? 'translate-x-4' : 'translate-x-0.5'}"></div>
									</div>
								</button>
							</div>
						</div>
					</section>

					<section class="settings-section">
						<div class="settings-section-head">
							<span>Search</span>
							{#if searchEngine !== 'default'}
								<button
									type="button"
									class="link-btn"
									onclick={resetSearchEngine}
								>Reset to default</button>
							{/if}
						</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Search engine</div>
								<div class="setting-hint">
									{#if currentEngine}
										Searches go to <span class="text-content-muted">{currentEngine.name}</span>{#if currentEngine.serverDefault}{' '}(the server default){/if}, using <code class="engine-param">{currentEngine.param}</code>.
									{:else}
										No search URL is configured, so web searches stay in the launcher.
									{/if}
								</div>
							</div>
							<div class="setting-control">
								<select
									class="engine-select"
									value={searchEngine}
									onchange={(e) => setSearchEngine(e.currentTarget.value)}
									aria-label="Search engine"
								>
									{#each SEARCH_ENGINES as option}
										<option value={option.id}>{option.label}</option>
									{/each}
								</select>
							</div>
						</div>

						{#if searchEngine === 'custom'}
							<div class="setting-subblock">
								<div class="engine-fields">
									<label class="engine-field">
										<span>Search URL</span>
										<input
											class="engine-input"
											type="url"
											inputmode="url"
											placeholder="https://searxng.example.com/search"
											value={searchEngineUrl}
											oninput={(e) => setSearchEngineField('url', e.currentTarget.value)}
										/>
									</label>
									<div class="engine-field-row">
										<label class="engine-field">
											<span>Query parameter</span>
											<input
												class="engine-input"
												type="text"
												placeholder="q"
												value={searchEngineParam}
												oninput={(e) => setSearchEngineField('param', e.currentTarget.value)}
											/>
										</label>
										<label class="engine-field">
											<span>Display name</span>
											<input
												class="engine-input"
												type="text"
												placeholder="SearXNG"
												value={searchEngineName}
												oninput={(e) => setSearchEngineField('name', e.currentTarget.value)}
											/>
										</label>
									</div>
									<label class="engine-field">
										<span>Icon</span>
										<input
											class="engine-input"
											type="text"
											placeholder="si:duckduckgo or URL"
											value={searchEngineIcon}
											oninput={(e) => setSearchEngineField('icon', e.currentTarget.value)}
										/>
										<span class="setting-hint">A URL or a Simple Icons slug. Leave name and icon blank to use the host.</span>
									</label>
								</div>
							</div>
						{/if}
					</section>
				</div>

				{:else if activeTab === 'appearance'}
				<!-- ═══ APPEARANCE TAB ═══ -->
				<header class="tab-head">
					<div class="tab-title">Appearance</div>
					<div class="tab-sub">Customize how your dashboard looks.</div>
				</header>

				<div class="settings">
					<section class="settings-section">
						<div class="settings-section-head">Theme</div>
						<div class="setting-subblock flush">
							<div class="theme-grid" role="radiogroup" aria-label="Theme">
								{#each themes as t}
									<button
										type="button"
										role="radio"
										aria-checked={theme === t.id}
										class="theme-option"
										class:is-active={theme === t.id}
										title={t.label}
										onclick={() => setTheme(t.id)}
									>
										<span class="theme-dot" style={`--swatch: ${t.dot}`}></span>
										<span class="theme-name">{t.label}</span>
									</button>
								{/each}
							</div>
						</div>
					</section>

					<section class="settings-section">
						<div class="settings-section-head">Layout &amp; icons</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Glass</div>
								<div class="setting-hint">How much tint and blur the cards, menus and search take.</div>
							</div>
							<div class="setting-control wrap">
								<div class="segmented" role="radiogroup" aria-label="Glass">
									{#each glassLevels as level}
										<button
											type="button"
											role="radio"
											aria-checked={($prefs.glass || 'frosted') === level.id}
											class="segmented-item"
											class:is-active={($prefs.glass || 'frosted') === level.id}
											onclick={() => setGlass(level.id)}
										>{level.label}</button>
									{/each}
								</div>
							</div>
						</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Icon style</div>
								<div class="setting-hint">Full-colour brand icons, white glyphs, or muted grey.</div>
							</div>
							<div class="setting-control wrap">
								<div class="segmented" role="radiogroup" aria-label="Icon style">
									{#each iconStyles as style}
										<button
											type="button"
											role="radio"
											aria-checked={iconStyle === style.id}
											class="segmented-item"
											class:is-active={iconStyle === style.id}
											onclick={() => setIconStyle(style.id)}
										>{style.label}</button>
									{/each}
								</div>
							</div>
						</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Card size</div>
								<div class="setting-hint">Compact icons, standard cards, or wide cards with descriptions.</div>
							</div>
							<div class="setting-control wrap">
								<div class="segmented" role="radiogroup" aria-label="Card size">
									{#each cardSizes as size}
										<button
											type="button"
											role="radio"
											aria-checked={cardSize === size.id}
											class="segmented-item"
											class:is-active={cardSize === size.id}
											onclick={() => setCardSize(size.id)}
										>{size.label}</button>
									{/each}
								</div>
							</div>
						</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Layout width</div>
								<div class="setting-hint">Standard is a centred 1200px column; Wide fills widescreen; Full uses the viewport.</div>
							</div>
							<div class="setting-control wrap">
								<div class="segmented" role="radiogroup" aria-label="Layout width">
									{#each layoutWidths as widthOption}
										<button
											type="button"
											role="radio"
											aria-checked={containerWidth === widthOption.id}
											class="segmented-item"
											class:is-active={containerWidth === widthOption.id}
											onclick={() => setContainerWidth(widthOption.id)}
										>{widthOption.label}</button>
									{/each}
								</div>
							</div>
						</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Text size</div>
								<div class="setting-hint">Scales every rem on the page. Tap the percentage to reset.</div>
							</div>
							<div class="setting-control slider-control">
								<button
									type="button"
									class="text-[0.7rem] tabular-nums text-content-muted bg-transparent border-none cursor-pointer hover:text-content font-mono"
									onclick={() => setTextScale(100)}
									title="Reset to 100%"
									aria-label={`Text size ${textScale} percent, reset to 100 percent`}
								>{textScale}%</button>
								<input
									type="range"
									class="text-slider"
									min="85"
									max="130"
									step="5"
									value={textScale}
									oninput={(e) => setTextScale(e.currentTarget.value)}
									aria-label="Text size"
								/>
							</div>
						</div>
					</section>

					<section class="settings-section">
						<div class="settings-section-head">Ambience</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Particles</div>
								<div class="setting-hint">A decorative particle layer behind the dashboard.</div>
							</div>
							<div class="setting-control">
								<button
									class="bg-transparent border-none cursor-pointer p-0"
									role="switch"
									aria-checked={particlesEnabled}
									aria-label="Particles"
									onclick={toggleParticles}
								>
									<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {particlesEnabled ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
										<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {particlesEnabled ? 'translate-x-4' : 'translate-x-0.5'}"></div>
									</div>
								</button>
							</div>
						</div>

						{#if particlesEnabled}
							<div class="setting-row">
								<div class="setting-copy">
									<div class="setting-name">Particle style</div>
									<div class="setting-hint">The shape of the drifting background.</div>
								</div>
								<div class="setting-control wrap">
									<UnitPicker key="particlesStyle" label="Style" options={particleStyles} fallback="constellation" compact />
								</div>
							</div>

							<div class="setting-row">
								<div class="setting-copy">
									<div class="setting-name">Interactive</div>
									<div class="setting-hint">Follow the pointer and react to clicks.</div>
								</div>
								<div class="setting-control">
									<button
										class="bg-transparent border-none cursor-pointer p-0"
										role="switch"
										aria-checked={particlesInteractive}
										aria-label="Interactive particles"
										onclick={toggleParticlesInteractive}
									>
										<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {particlesInteractive ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
											<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {particlesInteractive ? 'translate-x-4' : 'translate-x-0.5'}"></div>
										</div>
									</button>
								</div>
							</div>
						{/if}
					</section>

					<section class="settings-section {theme !== 'auto' ? 'opacity-40 pointer-events-none' : ''}">
						<div class="settings-section-head">Wallpaper {theme !== 'auto' ? '(Dynamic only)' : ''}</div>

						<div class="setting-row">
							<div class="setting-copy">
								<div class="setting-name">Wallpaper</div>
								<div class="setting-hint">Show a daily rotating image behind the dashboard. Dynamic theme only.</div>
							</div>
							<div class="setting-control">
								<button class="bg-transparent border-none cursor-pointer p-0" role="switch" aria-checked={wallpaperEnabled && theme === 'auto'} aria-label="Wallpaper" onclick={toggleWallpaper}>
									<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {wallpaperEnabled && theme === 'auto' ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
										<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {wallpaperEnabled && theme === 'auto' ? 'translate-x-4' : 'translate-x-0.5'}"></div>
									</div>
								</button>
							</div>
						</div>

						{#if wallpaperEnabled && theme === 'auto'}
							<div class="setting-subblock">
								<button
									class="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[0.75rem] font-mono cursor-pointer transition-all duration-150 mb-2 {!wallpaperId ? 'bg-surface-card-strong text-content border border-border-pill' : 'bg-transparent text-content-dim border border-border-card hover:bg-surface-card-hover'}"
									onclick={() => selectWallpaper(null)}
								>Daily rotation</button>

								<div class="grid grid-cols-3 max-md:grid-cols-2 gap-1.5">
									{#each Array.from({length: WALLPAPERS_PER_PAGE}, (_, i) => wallpaperPage * WALLPAPERS_PER_PAGE + i + 1).filter(id => id <= wallpaperCount) as id}
										<button
											class="relative aspect-video rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-150 bg-surface-card {wallpaperId == id ? 'border-white/60 shadow-lg' : 'border-transparent hover:border-border-pill'}"
											onclick={() => selectWallpaper(id)}
										>
											<div class="absolute inset-0 shimmer"></div>
											<img
												src={getWallpaperThumbUrl(id, siteConfig?.wallpapers)}
												alt="Wallpaper {id}"
												loading="lazy"
												class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 opacity-0"
												onload={(e) => e.target.classList.replace('opacity-0', 'opacity-100')}
											/>
											{#if wallpaperId == id}
												<div class="absolute inset-0 bg-white/10 flex items-center justify-center z-10">
													<span class="text-white text-xs font-bold drop-shadow">✓</span>
												</div>
											{/if}
										</button>
									{/each}
								</div>

								<div class="flex items-center justify-between mt-2 px-1">
									<button
										class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono disabled:opacity-30 disabled:cursor-not-allowed"
										disabled={wallpaperPage === 0}
										onclick={() => wallpaperPage--}
									>← Prev</button>
									<span class="text-[0.7rem] text-content-dim font-mono">{wallpaperPage + 1} / {totalPages}</span>
									<button
										class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono disabled:opacity-30 disabled:cursor-not-allowed"
										disabled={wallpaperPage >= totalPages - 1}
										onclick={() => wallpaperPage++}
									>Next →</button>
								</div>
							</div>
						{/if}
					</section>
				</div>

				{:else if activeTab === 'widgets'}
				<!-- ═══ WIDGETS TAB ═══ -->
				<header class="tab-head">
					<div class="tab-title">Widgets</div>
					<div class="tab-sub">Turn parts of your page on or off. To add or move apps, use Edit on the dashboard.</div>
				</header>
				{@const widgets = [
					{ id: 'clock', name: 'Clock', desc: 'Time and date, top of page', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', fixed: true,
						settings: [{ key: 'timeFormat', label: 'Time format', options: TIME_FORMATS, fallback: DEFAULT_TIME_FORMAT }] },
					{ id: 'weather', name: 'Weather', desc: 'Conditions where you are', icon: 'M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
						settings: [{ key: 'tempUnit', label: 'Temperature', options: TEMP_UNITS, fallback: DEFAULT_TEMP_UNIT }] },
					{ id: 'search', name: 'Search', desc: 'Apps and files, mid-page', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
						settings: [
							{ key: 'searchOnFocus', label: 'On focus', options: SEARCH_ON_FOCUS, fallback: searchOnFocus(undefined, siteConfig?.search?.on_focus) },
							{ key: 'searchTransparency', label: 'Transparency', options: SEARCH_TRANSPARENCY, fallback: searchTransparency(undefined, siteConfig?.search?.transparency) },
							{ key: 'searchHints', label: 'Hints', options: SEARCH_HINTS, fallback: searchHints(undefined, siteConfig?.search?.hints) }
						] },
					...(siteConfig?.health?.enabled ? [{ id: 'health', name: 'App status', desc: 'A dot on tiles whose app is down or slow', icon: 'M3 12h4l3-8 4 16 3-8h4', on: healthDots, toggle: toggleHealthDots }] : [])
				]}

				<div class="settings">
					<section class="settings-section">
						<div class="settings-section-head">Page widgets</div>
						{#each widgets as widget}
							{@const on = widget.fixed || (widget.toggle ? widget.on : enabledWidgets.has(widget.id))}
							<div class="setting-row">
								<div class="setting-copy widget-copy">
									<span class="widget-icon">
										<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={widget.icon} /></svg>
									</span>
									<div class="min-w-0">
										<div class="setting-name">{widget.name}</div>
										<div class="setting-hint">{widget.desc}</div>
									</div>
								</div>
								<div class="setting-control">
									{#if widget.fixed}
										<span class="always-on">Always on</span>
									{:else}
										<button
											class="bg-transparent border-none cursor-pointer p-0"
											role="switch"
											aria-checked={on}
											aria-label={widget.name}
											onclick={() => (widget.toggle ? widget.toggle() : toggleWidget(widget.id))}
										>
											<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {on ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
												<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {on ? 'translate-x-4' : 'translate-x-0.5'}"></div>
											</div>
										</button>
									{/if}
								</div>
							</div>
							{#if widget.settings && on}
								<div class="setting-subblock tight">
									{#each widget.settings as setting}
										<UnitPicker {...setting} inline />
									{/each}
								</div>
							{/if}
						{/each}
					</section>

					{#if integrationWidgets.length}
						<section class="settings-section">
							<div class="settings-section-head">Connected apps</div>
							{#each integrationWidgets as it (it.id)}
								{@const on = widgetPending[it.id] ?? it.userState.surfaces?.widgets === true}
								<div class="setting-row">
									<div class="setting-copy widget-copy">
										<span class="widget-icon">
											<AppIcon icon={resolveIcon(it.icon)} name={it.name} size="w-4 h-4" iconStyle="white" />
										</span>
										<div class="min-w-0">
											<div class="setting-name">{it.name}</div>
											<div class="setting-hint" title={it.widgets.map((w) => w.label).join(', ')}>{it.widgets.map((w) => w.label).join(', ')}</div>
										</div>
									</div>
									<div class="setting-control">
										<button
											class="bg-transparent border-none cursor-pointer p-0"
											role="switch"
											aria-checked={on}
											aria-busy={it.id in widgetPending}
											aria-label={`${it.name} widgets`}
											onclick={() => toggleIntegrationWidgets(it)}
										>
											<div class="w-9 h-5 rounded-full transition-colors duration-200 relative shrink-0 {on ? 'bg-surface-toggle-on' : 'bg-surface-toggle-off'}">
												<div class="absolute top-0.5 w-4 h-4 rounded-full bg-surface-toggle-knob shadow transition-transform duration-200 {on ? 'translate-x-4' : 'translate-x-0.5'}"></div>
											</div>
										</button>
									</div>
								</div>
							{/each}
						</section>
					{/if}
				</div>
				{#if widgetSaveError}
					<div class="px-2 pt-2 text-[0.7rem] text-red-400">{widgetSaveError}</div>
				{/if}

				{:else if activeTab === 'integrations'}
				<!-- ═══ INTEGRATIONS TAB ═══ -->
				<IntegrationsPanel {iconStyle} />

				{:else if activeTab === 'config'}
				<!-- ═══ CONFIG TAB (admins) ═══ -->
				<ConfigManager bind:this={configManager} onstate={handleConfigState} />

				{/if}
				<!-- On phones the sidebar is hidden: Reset defaults and the version sit
				     under the tab, flush with its content. The Config tab owns its
				     full height, so nothing is appended under it. -->
				{#if activeTab !== 'config'}
					<div class="hidden max-md:flex flex-col items-start gap-1.5 mt-6">
						{#if customizationEnabled}
							{#if resetUndo}
								<button class="text-[0.7rem] text-content bg-transparent border-none cursor-pointer underline underline-offset-2 font-mono p-0" onclick={undoResetDefaults}>Undo reset</button>
							{:else}
								<button class="text-[0.7rem] text-content-dim bg-transparent border-none cursor-pointer hover:text-content transition-colors font-mono p-0" onclick={resetDefaults}>Reset defaults</button>
							{/if}
						{/if}
						{#if version}
							<div class="version-line flush">{@render versionLinks()}</div>
						{/if}
					</div>
				{/if}
				</div>
			</div>
		</div>

		</div>
	</div>
{/if}

<style>
	/* Size comes from the utility classes in the markup; only the flex
	   constraints live here so the panes scroll, not the modal shell. */
	.configure-card {
		min-height: 0;
	}
	/* Eight themes, so a segmented row would overflow: a compact swatch grid
	   keeps every palette one click away. */
	.theme-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.35rem;
	}
	.theme-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-height: 3.15rem;
		padding: 0.4rem 0.2rem;
		border-radius: 9px;
		border: 1px solid var(--glass-border);
		background: var(--input-bg);
		color: var(--text-dim);
		font-family: inherit;
		font-size: 0.65rem;
		line-height: 1.15;
		text-align: center;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}
	.theme-option:hover {
		color: var(--text-muted);
		border-color: var(--pill-border);
	}
	.theme-option.is-active {
		background: var(--segment-on);
		color: var(--text);
		border-color: var(--pill-border);
		box-shadow: var(--glass-highlight), 0 1px 3px rgba(0, 0, 0, 0.2);
	}
	.theme-dot {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 9999px;
		background: var(--swatch);
		box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.45), 0 0 8px -2px var(--swatch);
	}
	.theme-name {
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.text-slider {
		width: 100%;
		margin: 0;
		accent-color: var(--accent, #f5b942);
		cursor: pointer;
	}
	.tab-head {
		margin-bottom: 1.5rem;
	}
	.tab-title {
		color: var(--text);
		font-size: 0.95rem;
		font-weight: 600;
	}
	.tab-sub {
		margin-top: 0.2rem;
		color: var(--text-dim);
		font-size: 0.72rem;
		line-height: 1.45;
	}
	.settings {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding-bottom: 0.5rem;
	}
	.settings-section {
		display: flex;
		flex-direction: column;
	}
	.settings-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.35rem;
		color: var(--text-dim);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}
	.setting-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, auto);
		align-items: center;
		gap: 0.6rem 1.5rem;
		padding: 0.9rem 0;
		border-top: 1px solid var(--glass-border);
	}
	.setting-row:first-of-type {
		border-top: none;
	}
	.setting-copy {
		min-width: 0;
	}
	.setting-copy.widget-copy {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
	}
	.setting-name {
		color: var(--text);
		font-size: 0.8rem;
		font-weight: 500;
	}
	.setting-hint {
		margin-top: 0.15rem;
		color: var(--text-dim);
		font-size: 0.68rem;
		line-height: 1.45;
	}
	.setting-control {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.55rem;
		min-width: 0;
	}
	.setting-control.wrap {
		flex-wrap: wrap;
	}
	.slider-control {
		width: min(18rem, 46vw);
	}
	.slider-control .text-slider {
		flex: 1 1 auto;
	}
	.setting-subblock {
		padding: 0.75rem;
		margin-bottom: 0.65rem;
		border: 1px solid var(--glass-border);
		border-radius: 10px;
		background: var(--input-bg);
	}
	.setting-subblock.flush {
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
	}
	.setting-subblock.tight {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.55rem 0.75rem;
		margin: 0 0 0.3rem;
	}
	.widget-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex: 0 0 auto;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--input-bg);
		color: var(--text-muted);
	}
	.always-on {
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--glass-border);
		border-radius: 9999px;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6rem;
	}
	.link-btn {
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.66rem;
		cursor: pointer;
	}
	.link-btn:hover {
		color: var(--text);
	}
	@media (max-width: 640px) {
		.setting-row {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.5rem;
		}
		.setting-control {
			justify-content: flex-start;
		}
		.slider-control {
			width: 100%;
		}
		.theme-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.version-line {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 0 0.75rem;
	}
	.version-line.flush { padding: 0; }
	.version-link {
		text-align: left;
		text-decoration: none;
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.68rem;
		color: var(--color-content-dim);
		opacity: 0.7;
		transition: opacity 0.15s ease;
	}
	.version-link:hover, .version-link:focus-visible { opacity: 1; color: var(--color-content); }
	.version-link.update { color: var(--color-content); opacity: 0.9; }
</style>
