<script>
	import { prefs } from '$lib/stores/prefs.js';
	import Dashboard from '$lib/components/Dashboard.svelte';

	import Footer from '$lib/components/Footer.svelte';
	import PrivacyTerms from '$lib/components/PrivacyTerms.svelte';
	import OnboardingModal from '$lib/components/OnboardingModal.svelte';
	import SettingsButton from '$lib/components/SettingsButton.svelte';
	import InstallPrompt from '$lib/components/InstallPrompt.svelte';
	import MiniPlayer from '$lib/components/MiniPlayer.svelte';
	import Reminders from '$lib/components/Reminders.svelte';
	import CornerStack from '$lib/components/CornerStack.svelte';
	import Changelog from '$lib/components/Changelog.svelte';
	import WallpaperBackground from '$lib/components/WallpaperBackground.svelte';
	import ParticleBackground from '$lib/components/ParticleBackground.svelte';

	import DynamicFavicon from '$lib/components/DynamicFavicon.svelte';
	import InlineTip from '$lib/components/InlineTip.svelte';
	import ManageApps from '$lib/components/ManageApps.svelte';
	import PasswordChangePrompt from '$lib/components/PasswordChangePrompt.svelte';

	import { browser } from '$app/environment';
	import { get } from 'svelte/store';

	let { data } = $props();
	let privacyOpen = $state(false);
	let onboarded = $state(false);
	let guideApp = $state(null);
	let menuOpen = $state(false);
	let manageAppsOpen = $state(false);
	let editMode = $state(false);

	import { buildAppsFromConfig } from '$lib/apps.js';
	import { getContext } from 'svelte';

	const siteConfig = getContext('config');
	const authEnabled = siteConfig?.auth?.enabled ?? false;
	const customizationEnabled = siteConfig?.customization?.enabled ?? false;
	// The Config tab is for the fixed "admins" group. An admin can open
	// Configure even when customization is off; everyone else still can't.
	const adminEnabled = siteConfig?.admin?.enabled === true;
	const configureEnabled = customizationEnabled || adminEnabled;
	const onboardingEnabled = siteConfig?.onboarding?.enabled ?? false;
	const wallpapersEnabled = siteConfig?.wallpapers?.enabled ?? false;
	const weatherConfigEnabled = siteConfig?.weather?.enabled ?? false;
	const tipsEnabled = siteConfig?.tips?.enabled ?? false;
	const privacyEnabled = siteConfig?.privacy?.enabled ?? false;
	const footerEnabled = siteConfig?.branding?.show_footer !== false;

	const searchConfigEnabled = siteConfig?.search?.enabled ?? false;

	// Widget visibility: config enables feature, user prefs toggle per-user
	const userWidgets = $derived(new Set($prefs.enabledWidgets || ['weather', 'search']));
	const weatherEnabled = $derived(weatherConfigEnabled && userWidgets.has('weather'));
	const searchEnabled = $derived(searchConfigEnabled && userWidgets.has('search'));

	const { apps: allApps, setupGuides } = buildAppsFromConfig(siteConfig?.apps);
	const tipApps = Object.fromEntries(
		allApps.filter(app => setupGuides[app.name]).map(app => [app.name, app])
	);

	const loggedIn = !!(data.authName);
	// No auth = always show dashboard (no login gate)
	const showDashboard = !authEnabled || loggedIn;

	// Dev mode: reset onboarding on every fresh load (no ?user param)
	if (browser && data.devMode && !loggedIn) {
		prefs.reset();
	}

	// Signed in: prefs come from the server with the page data, so this is
	// synchronous and the server-rendered dashboard stays on screen through
	// hydration. With auth off there is no account, so prefs stay local.
	if (browser && loggedIn) {
		if (data.prefs) {
			prefs.applyServerPrefs(data.prefs, { name: data.authName, username: data.authUsername });
		} else {
			prefs.update((p) => ({ ...p, name: data.authName, username: data.authUsername, firstLoginAt: p.firstLoginAt || new Date().toISOString() }));
			// With auth off the one durable account is guest, so the first visit
			// keeps this browser's choices and starts syncing them to SQLite. A
			// new signed-in account starts empty instead: this browser may have
			// belonged to someone else.
			if (!authEnabled) {
				prefs.enableServerSync();
				prefs.update((p) => ({ ...p }));
			}
		}
	}

	// Also decided at top level (not only in the effect) so the server render
	// doesn't include the onboarding modal for users who already finished it.
	if (!onboardingEnabled || !authEnabled || data.prefs?.onboarded) onboarded = true;
	$effect(() => {
		if ($prefs.onboarded) onboarded = true;
	});

	// First-login screens show one at a time: onboarding (with its password
	// slide, if listed), then the password gate for anyone who still needs it,
	// then the install bar. Mirrors PasswordChangePrompt's own `blocked` check.
	const passwordGate = $derived(
		authEnabled &&
		onboarded &&
		!!siteConfig?.onboarding?.slides?.some((s) => s.type === 'password') &&
		!!siteConfig?.auth?.password_change_url &&
		!$prefs.passwordVerified &&
		!!$prefs.firstLoginAt
	);

	// Apply theme class to body
	// The prefs store is a module singleton and stays empty on the server, so
	// the server render reads this request's prefs from page data instead;
	// otherwise SSR picks the default theme and today's wallpaper, and the
	// browser downloads the wrong background before hydration swaps it.
	const viewPrefs = $derived(browser ? $prefs : data.prefs || {});
	const theme = $derived(viewPrefs.theme || 'auto');

	// How wide the dashboard column runs. Standard keeps the old centred
	// 1200px measure, Wide is the default and fills a laptop or widescreen
	// display, and Full gives the grids the whole viewport. Phones use the
	// same narrow outer padding in every mode.
	const CONTAINER_WIDTHS = {
		standard: 'max-w-[1200px] px-16 max-lg:px-12',
		wide: 'max-w-[1600px] px-10 max-lg:px-8',
		full: 'max-w-none px-7 max-lg:px-6'
	};
	const containerClass = $derived(
		CONTAINER_WIDTHS[viewPrefs.containerWidth] || CONTAINER_WIDTHS.wide
	);
	// Built-in palettes that ride on .theme-dark; app.css has a block each.
	const NAMED_THEMES = ['obsidian', 'amethyst', 'oled', 'tokyo', 'emerald'];
	$effect(() => {
		if (!browser) return;
		// Dark themes share .theme-dark for every dark-theme rule; the named
		// class below swaps the palette tokens.
		document.body.classList.remove(
			'theme-light',
			'theme-dark',
			...NAMED_THEMES.map((t) => `theme-${t}`)
		);
		if (theme === 'light') document.body.classList.add('theme-light');
		else if (theme === 'dark') document.body.classList.add('theme-dark');
		else if (NAMED_THEMES.includes(theme)) {
			document.body.classList.add('theme-dark', `theme-${theme}`);
		}
	});
	$effect(() => {
		if (!browser) return;
		document.documentElement.dataset.glass = viewPrefs.glass || 'frosted';
	});

	// Text size scales the root font size, so every rem-based size on the
	// page (headers, cards, search, settings) grows or shrinks together.
	$effect(() => {
		if (!browser) return;
		const scale = Number(viewPrefs.textScale);
		document.documentElement.style.fontSize =
			Number.isFinite(scale) && scale >= 85 && scale <= 130 ? `${scale}%` : '';
	});


	// Weather shows only for a location the user chose from the weather
	// menu in the header. When that choice is "my device", keep it
	// current: refresh on load and whenever the browser permission flips to
	// granted, and drop the coordinates if the permission is revoked so the
	// widget hides instead of showing a stale place. Manually chosen places
	// are never overwritten.
	const followDevice = $derived(
		weatherEnabled && !!($prefs.lat && $prefs.lon) && $prefs.locationSource !== 'manual'
	);
	$effect(() => {
		if (!browser || !followDevice) return;
		let permStatus = null;
		let cancelled = false;

		function fetchAndStore() {
			navigator.geolocation?.getCurrentPosition(
				(pos) => {
					if (cancelled) return;
					const cur = get(prefs);
					if (Math.abs(pos.coords.latitude - cur.lat) > 0.01 || Math.abs(pos.coords.longitude - cur.lon) > 0.01) {
						prefs.update((p) => ({
							...p,
							lat: pos.coords.latitude,
							lon: pos.coords.longitude,
							locationSource: 'device'
						}));
					}
				},
				() => {}
			);
		}

		function forgetLocation() {
			prefs.update((p) => ({ ...p, lat: null, lon: null, locationSource: null, locationName: null }));
		}

		function onPermState(state) {
			if (state === 'granted') fetchAndStore();
			else if (state === 'denied') forgetLocation();
		}
		const onPermChange = () => onPermState(permStatus?.state);

		if (navigator.permissions?.query) {
			navigator.permissions
				.query({ name: 'geolocation' })
				.then((status) => {
					if (cancelled) return;
					permStatus = status;
					onPermState(status.state);
					status.addEventListener('change', onPermChange);
				})
				.catch(fetchAndStore);
		} else {
			fetchAndStore();
		}

		return () => {
			cancelled = true;
			permStatus?.removeEventListener('change', onPermChange);
		};
	});

	function onOnboardingComplete() {
		onboarded = true;
	}
</script>

{#if authEnabled && !loggedIn}
	<!-- Login screen (only when auth is enabled) -->
	<OnboardingModal oncomplete={onOnboardingComplete} authName={data.authName} authUsername={data.authUsername} devMode={data.devMode} />
{:else if showDashboard}
	<!-- Password change gate (only when auth + password_change_url configured) -->
	{#if authEnabled}
		<PasswordChangePrompt ready={onboarded} />
	{/if}
	<!-- Dashboard -->
	{#if wallpapersEnabled && theme === 'auto' && (viewPrefs.wallpaperEnabled !== false)}
		<WallpaperBackground wallpaperId={viewPrefs.wallpaperId || null} />
	{/if}
	<ParticleBackground {theme} />
<DynamicFavicon />
	<div class="relative z-10 w-full {containerClass} min-h-dvh flex flex-col pb-6 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] max-md:px-5 {footerEnabled ? 'max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]' : 'max-md:pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]'} max-md:pt-[calc(1.5rem+env(safe-area-inset-top,0px))] max-md:max-w-full max-xs:px-4 max-xs:pt-[calc(1.25rem+env(safe-area-inset-top,0px))] {viewPrefs.iconStyle === 'grayed' ? 'grayed-widgets' : ''} {wallpapersEnabled && theme === 'auto' && viewPrefs.wallpaperEnabled !== false ? 'wallpaper-active' : ''}">
		<!-- Phones: the footer's line sits level with the floating account
		     button; with no footer, the bottom padding keeps the last apps
		     clear of it (12px + 50px button + a gap). -->
		<!-- Fill mode backwards, not both: a filled opacity animation keeps the
		     wrapper a backdrop root, and the weather menu's glass inside it
		     would stop blurring the search bar below. -->
		<div class="launcher-host opacity-0 animate-fade-in-up [animation-fill-mode:both] [animation-delay:75ms] relative z-20">
			<Dashboard
				bind:guideApp
				bind:editMode
				{searchEnabled}
				{customizationEnabled}
				onSettingsOpen={() => (manageAppsOpen = true)}
				initialBookmarks={data.bookmarks}
				initialCategories={data.bookmarkCategories}
				lat={$prefs.lat}
				lon={$prefs.lon}
				placeName={$prefs.locationSource === 'manual' ? $prefs.locationName : ''}
				locationSource={$prefs.locationSource}
				showWeather={weatherEnabled}
			/>
		</div>
		<!-- Inline help tips disabled for now — revisit once the palette
		     layout is settled and we decide where tips fit in. -->
		{#if false && tipsEnabled}
			<div class="opacity-0 animate-fade-in [animation-fill-mode:both] [animation-delay:250ms]">
				<InlineTip onsetup={(appName) => { guideApp = tipApps[appName] || null; }} />
			</div>
		{/if}
		<div class="flex-1"></div>
		{#if footerEnabled}
			<div class="opacity-0 animate-fade-in [animation-fill-mode:both] [animation-delay:300ms]">
				<Footer onOpenPrivacy={privacyEnabled ? () => privacyOpen = true : null} />
			</div>
		{/if}
	</div>
	{#if privacyEnabled}
		<PrivacyTerms bind:open={privacyOpen} standalone />
	{/if}
	<SettingsButton bind:open={menuOpen} onmanageapps={configureEnabled ? () => manageAppsOpen = true : null} showAuth={authEnabled} />
	{#if configureEnabled}
		<ManageApps bind:open={manageAppsOpen} />
	{/if}
	<InstallPrompt devMode={data.devMode} ready={onboarded && !passwordGate} />
	<CornerStack>
		<Reminders />
		<MiniPlayer />
	</CornerStack>
	<Changelog ready={onboarded && !passwordGate} />

	<!-- Post-login onboarding (only when auth + onboarding enabled) -->
	{#if authEnabled && onboardingEnabled && !onboarded}
		<OnboardingModal oncomplete={onOnboardingComplete} authName={data.authName} authUsername={data.authUsername} devMode={data.devMode} />
	{/if}
{/if}
