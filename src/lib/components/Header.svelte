<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Weather from './Weather.svelte';
	import Upcoming from './Upcoming.svelte';
	import { DAYS, MONTHS } from '$lib/constants.js';
	import { fetchWeather, reverseGeocode } from '$lib/weather.js';
	import { prefs } from '$lib/stores/prefs.js';
	import { clockParts, TIME_FORMATS, DEFAULT_TIME_FORMAT } from '$lib/units.js';
	import UnitPicker from './UnitPicker.svelte';
	// lat/lon are the user's chosen location (device or a searched place);
	// without one, the weather pill offers to set it. placeName is set for a
	// searched place, which needs no reverse lookup.
	// search is a snippet supplied by the dashboard: the unified search bar
	// sits in the centre column so the clock, search and weather share one
	// top row. showSearch is false when the user turned the search widget off.
	let {
		lat,
		lon,
		placeName = '',
		locationSource = null,
		showWeather = true,
		showSearch = false,
		search = null
	} = $props();

	let weatherData = $state(null);
	let weatherLoaded = $state(false);
	let locationName = $state('');
	let now = $state(new Date());

	const clock = $derived(clockParts(now, $prefs.timeFormat));

	// The clock opens a small menu for its time format.
	let clockOpen = $state(false);
	let clockEl = $state();
	$effect(() => {
		if (!clockOpen) return;
		const onDown = (e) => { if (!clockEl?.contains(e.target)) clockOpen = false; };
		const onKey = (e) => {
			if (e.key !== 'Escape') return;
			clockOpen = false;
			clockEl?.querySelector('button')?.focus();
		};
		document.addEventListener('pointerdown', onDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	});

	function formatDate() {
		const d = now;
		const day = DAYS[d.getDay()].slice(0, 3);
		const month = MONTHS[d.getMonth()].slice(0, 3);
		const date = d.getDate();
		return `${day} · ${month} ${date}`;
	}

	$effect(() => {
		weatherData = null;
		weatherLoaded = false;
		locationName = '';
		if (!browser || !showWeather || !(lat && lon)) return;
		let stale = false;
		if (placeName) locationName = placeName;
		else reverseGeocode(lat, lon).then((n) => { if (!stale) locationName = n; });
		fetchWeather(lat, lon).then((d) => { if (!stale) { weatherData = d; weatherLoaded = true; } });
		return () => { stale = true; };
	});

	onMount(() => {
		const timer = setInterval(() => { now = new Date(); }, 60000);
		return () => clearInterval(timer);
	});
</script>

<!-- Top status row: clock and next event on the left, the unified search in
     the centre, and weather on the right. Desktop keeps them on one baseline;
     phones put clock + weather on one row and the search beneath. -->
<div class="dashboard-topbar text-[0.85rem] max-md:text-[0.75rem] font-mono tracking-[0.12em] uppercase" class:has-search={showSearch && search}>
	<div class="dashboard-header header-left">
		<div class="relative self-start" bind:this={clockEl}>
			<button
				type="button"
				class="header-trigger items-baseline gap-3 min-w-0 max-md:h-7 max-md:leading-7 bg-transparent cursor-pointer font-mono tracking-[0.12em] uppercase text-left"
				aria-haspopup="dialog"
				aria-expanded={clockOpen}
				title="Time format"
				onclick={() => (clockOpen = !clockOpen)}
			>
				<span class="text-[1.35rem] max-md:text-[1.1rem] font-semibold text-content tabular-nums tracking-tight normal-case">{clock.time}{#if clock.dayPeriod}<span class="clock-period">{clock.dayPeriod}</span>{/if}</span>
				<span class="text-content-muted whitespace-nowrap">{formatDate()}</span>
			</button>
			{#if clockOpen}
				<div
					class="absolute left-0 top-full mt-2 z-[70] w-[17rem] glass-card menu-surface rounded-xl shadow-theme animate-menu-up normal-case tracking-normal font-mono text-content px-4 pt-2.5 pb-3"
					role="dialog"
					aria-label="Time format"
				>
					<UnitPicker key="timeFormat" label="Time format" options={TIME_FORMATS} fallback={DEFAULT_TIME_FORMAT} compact />
				</div>
			{/if}
		</div>
		<Upcoming />
	</div>
	{#if showSearch && search}
		<div class="header-center">
			{@render search()}
		</div>
	{/if}
	<div class="dashboard-header header-right">
		{#if showWeather}<Weather {weatherData} {weatherLoaded} {locationName} hasLocation={!!(lat && lon)} source={locationSource === 'manual' ? 'manual' : 'device'} />{/if}
	</div>
</div>

<style>
	/* One row on desktop; the search takes the middle and can flex. Without
	   search, left and right simply push apart. */
	.dashboard-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
		margin-bottom: 2rem;
	}
	.dashboard-topbar.has-search {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(15rem, 2.2fr) minmax(0, 1fr);
		align-items: center;
		gap: 1.5rem;
	}
	.header-left {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.header-center {
		min-width: 0;
		width: 100%;
	}
	.header-right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 0;
	}
	@media (max-width: 767px) {
		.dashboard-topbar {
			margin-bottom: 1.5rem;
		}
		.dashboard-topbar.has-search {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'left right'
				'center center';
			align-items: start;
			gap: 0.85rem;
		}
		.header-left { grid-area: left; }
		.header-right { grid-area: right; }
		.header-center { grid-area: center; }
	}

	/* AM/PM rides beside the digits, small, so the time still leads. */
	.clock-period {
		margin-left: 0.3em;
		font-size: 0.55em;
		font-weight: 500;
		letter-spacing: 0.08em;
		color: var(--color-content-muted);
	}
</style>
