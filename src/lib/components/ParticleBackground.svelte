<script>
	import { browser } from '$app/environment';
	import { prefs } from '$lib/stores/prefs.js';

	// A decorative particle canvas behind the dashboard. The engine is
	// imported in the browser only (on first use) so SSR never touches it,
	// and the palette is read from the active theme's CSS tokens so every
	// theme — including the named ones — tints its own particles.
	let { theme = 'auto' } = $props();

	let EngineParticles = $state(null);
	let engineReady = $state(false);
	let loading = $state(false);
	let options = $state(null);

	const STYLES = ['constellation', 'dust', 'starfield'];
	const enabled = $derived($prefs.particlesEnabled === true);
	const preset = $derived(STYLES.includes($prefs.particlesStyle) ? $prefs.particlesStyle : 'constellation');
	// On by default; the switch turns hover/click reactions off without
	// removing the canvas.
	const interactive = $derived($prefs.particlesInteractive !== false);

	// Fallbacks in case a token is missing (custom branding builds, first
	// frame before the theme class lands).
	const ACCENTS = {
		obsidian: '#d9b26f',
		amethyst: '#a855f7',
		oled: '#c084fc',
		tokyo: '#7aa2f7',
		emerald: '#10b981',
		dark: '#f5b942',
		light: '#f5b942'
	};

	async function startEngine() {
		if (loading || engineReady) return;
		loading = true;
		try {
			const [pkg, slim] = await Promise.all([
				import('@tsparticles/svelte'),
				import('@tsparticles/slim')
			]);
			await pkg.initParticlesEngine(async (engine) => {
				await slim.loadSlim(engine);
			});
			EngineParticles = pkg.default;
			engineReady = true;
		} catch (err) {
			// A missing chunk shouldn't take the dashboard down with it.
			console.warn('Particles could not start', err);
		} finally {
			loading = false;
		}
	}

	// Load the engine the first time someone switches particles on.
	$effect(() => {
		if (browser && enabled) startEngine();
	});

	function palette() {
		if (!browser) return { accent: ACCENTS.dark, foreground: '#e4e4e7' };
		const s = getComputedStyle(document.body);
		const accent = s.getPropertyValue('--accent').trim() || ACCENTS[theme] || ACCENTS.dark;
		const foreground =
			s.getPropertyValue('--text-muted').trim() || (theme === 'light' ? '#3f3f46' : '#e4e4e7');
		return { accent, foreground };
	}

	function buildOptions(style, accent, foreground, interactive) {
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const speed = reduced ? 0 : undefined;
		// The canvas sits behind the page and ignores pointer events, so the
		// engine watches the window instead: the dashboard's cards and buttons
		// still take every click, while particles react across the viewport.
		const hoverMode = style === 'constellation' ? 'grab' : style === 'dust' ? 'bubble' : 'repulse';
		const shared = {
			fullScreen: { enable: false },
			detectRetina: true,
			fpsLimit: 60,
			background: { color: 'transparent' },
			interactivity: {
				detectsOn: 'window',
				events: {
					onHover: { enable: interactive, mode: hoverMode },
					onClick: { enable: interactive, mode: 'push' },
					resize: { enable: true }
				},
				modes: {
					grab: { distance: 160, links: { opacity: 0.4, color: accent } },
					bubble: { distance: 140, duration: 2, size: 3.2, opacity: 0.45 },
					repulse: { distance: 110, duration: 0.4, speed: 1 },
					push: { quantity: 3 }
				}
			}
		};

		if (style === 'dust') {
			return {
				...shared,
				particles: {
					number: { value: 110, density: { enable: true, width: 1920, height: 1080 } },
					color: { value: [foreground, accent] },
					shape: { type: 'circle' },
					opacity: { value: { min: 0.12, max: 0.4 }, animation: { enable: true, speed: 0.25, sync: false } },
					size: { value: { min: 0.7, max: 2.4 } },
					links: { enable: false },
					move: { enable: true, speed: speed ?? 0.18, direction: 'top', straight: false, outModes: { default: 'out' } }
				}
			};
		}

		if (style === 'starfield') {
			return {
				...shared,
				particles: {
					number: { value: 170, density: { enable: true, width: 1920, height: 1080 } },
					color: { value: [foreground, accent] },
					shape: { type: 'circle' },
					opacity: {
						value: { min: 0.18, max: 0.75 },
						animation: { enable: true, speed: 0.6, minimumValue: 0.1, sync: false }
					},
					size: { value: { min: 0.5, max: 1.7 } },
					links: { enable: false },
					move: { enable: !reduced, speed: speed ?? 0.05, direction: 'none', outModes: { default: 'out' } }
				}
			};
		}

		// Constellation (default): accent dots joined by faint lines.
		return {
			...shared,
			particles: {
				number: { value: 70, density: { enable: true, width: 1920, height: 1080 } },
				color: { value: accent },
				shape: { type: 'circle' },
				opacity: { value: { min: 0.22, max: 0.55 } },
				size: { value: { min: 1, max: 2.6 } },
				links: {
					enable: true,
					distance: 145,
					color: accent,
					opacity: 0.18,
					width: 1
				},
				move: { enable: !reduced, speed: speed ?? 0.32, direction: 'none', outModes: { default: 'out' } }
			}
		};
	}

	// Rebuild the options whenever the theme palette or preset changes; the
	// component reloads its container when the options object is replaced.
	$effect(() => {
		if (!browser || !engineReady || !enabled) return;
		theme;
		preset;
		interactive;
		const { accent, foreground } = palette();
		options = buildOptions(preset, accent, foreground, interactive);
	});
</script>

{#if engineReady && enabled && options && EngineParticles}
	<div class="particle-layer" aria-hidden="true">
		<EngineParticles id="holm-particles" class="particle-canvas" {options} />
	</div>
{/if}

<style>
	.particle-layer {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		transition: opacity 180ms ease-out;
	}
	/* The search palette dims the page behind it; the particles step back
	   with the wallpaper rather than competing with the results. */
	:global(body.search-active) .particle-layer {
		opacity: 0.3;
	}
	:global(.particle-canvas) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.particle-layer :global(canvas) {
		display: block;
	}
</style>
