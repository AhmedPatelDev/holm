<script>
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import { resolveIcon } from '$lib/apps.js';
	import {
		configToYaml,
		flattenApps,
		isLegacyApps,
		parseConfigText,
		slugifyId,
		uniqueAppId
	} from '$lib/adminConfig.js';

	const SERVER_SECTIONS = [
		{ key: 'customization', label: 'Configure panel', hint: 'Per-user appearance, layout and app visibility.' },
		{ key: 'wallpapers', label: 'Wallpapers', hint: 'Daily wallpaper picker and rotation.' },
		{ key: 'weather', label: 'Weather', hint: 'Weather pill and location picker.' },
		{ key: 'onboarding', label: 'Onboarding', hint: 'First-login slides. Needs auth.enabled.' },
		{ key: 'privacy', label: 'Privacy notice', hint: 'Privacy dialog and its footer link.' },
		{ key: 'changelog', label: "What's new", hint: 'Release notes after an update.' },
		{ key: 'update_check', label: 'Update notice', hint: 'Ask GitHub for a newer release.' }
	];

	const FILTERS = [
		{ id: 'all', label: 'All' },
		{ id: 'portal', label: 'Portal' },
		{ id: 'service', label: 'Services' }
	];

	// The Configure header shows the Save Config button while the draft is
	// dirty, so the tab reports its state up through this callback.
	let { onstate = null } = $props();

	let loading = $state(true);
	let loadError = $state('');
	let status = $state(null);
	let raw = $state('');
	let savedRaw = $state('');
	let config = $state(null);
	let mode = $state('visual');
	let rawErrors = $state([]);
	let toast = $state(null);
	let toastTimer = null;
	let saving = $state(false);
	let search = $state('');
	let filter = $state('all');
	let editor = $state(null);
	let formError = $state('');
	let textareaEl = $state(null);
	let gutterEl = $state(null);

	const dirty = $derived(raw !== savedRaw);
	// Merely selecting a row must not count as an unsaved change: only the
	// buffer diverging from the values it opened with does.
	const formDirty = $derived.by(() => {
		if (!editor) return false;
		return JSON.stringify(editor.form) !== JSON.stringify(editor.initialForm);
	});
	const hasChanges = $derived(dirty || formDirty);
	const readOnly = $derived(status ? status.writable === false : false);
	const apps = $derived(flattenApps(config?.apps || []));
	const legacy = $derived(isLegacyApps(config?.apps));

	const filteredApps = $derived.by(() => {
		const term = search.trim().toLowerCase();
		return apps
			.map((app, index) => ({ app, index, key: `${app?.id || 'app'}:${index}` }))
			.filter(({ app }) => {
				if (filter === 'service' && app?.service !== true) return false;
				if (filter === 'portal' && app?.service === true) return false;
				if (!term) return true;
				const haystack = [
					app?.name,
					app?.id,
					app?.url,
					...(Array.isArray(app?.tags) ? app.tags : []),
					...(Array.isArray(app?.groups) ? app.groups : [])
				];
				return haystack.some((value) => String(value ?? '').toLowerCase().includes(term));
			});
	});

	const groupsSuggestions = $derived.by(() => {
		const set = new Set(['admins']);
		for (const app of apps) {
			for (const group of Array.isArray(app?.groups) ? app.groups : []) {
				if (typeof group === 'string' && group.trim()) set.add(group);
			}
		}
		for (const key of ['onboarding', 'privacy', 'changelog', 'update_check']) {
			const groups = config?.[key]?.groups;
			if (Array.isArray(groups)) {
				for (const group of groups) if (typeof group === 'string' && group.trim()) set.add(group);
			}
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	});

	const tagSuggestions = $derived.by(() => {
		const set = new Set();
		for (const app of apps) {
			for (const tag of Array.isArray(app?.tags) ? app.tags : []) {
				if (typeof tag === 'string' && tag.trim()) set.add(tag);
			}
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	});

	const lineCount = $derived(Math.max(1, raw.split('\n').length));
	const lineNumbers = $derived(Array.from({ length: lineCount }, (_, index) => index + 1));
	const errorLines = $derived(new Set(rawErrors.filter((err) => err?.line).map((err) => err.line)));

	const visualErrors = $derived.by(() => {
		if (!config || mode !== 'visual') return [];
		return parseConfigText(configToYaml(config)).errors;
	});
	const errors = $derived(mode === 'raw' ? rawErrors : visualErrors);
	const canSave = $derived(!!config && hasChanges && !errors.length && !readOnly && !saving && !loading);
	const previewIcon = $derived(
		editor
			? resolveIcon(editor.form.icon.trim() || (editor.iconIsObject ? editor.originalIcon : ''))
			: null
	);

	onMount(() => {
		load();
	});
	onDestroy(() => clearTimeout(toastTimer));

	$effect(() => {
		if (!onstate) return;
		onstate({
			hasChanges,
			canSave,
			saving,
			readOnly,
			mode,
			save: saveConfig
		});
	});

	async function load() {
		loading = true;
		loadError = '';
		try {
			const response = await fetch('/api/admin/config', { headers: { accept: 'application/json' } });
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || `Could not load config.yml (HTTP ${response.status}).`);
			status = data;
			raw = data.raw || '';
			savedRaw = raw;
			config = data.config || null;
			rawErrors = Array.isArray(data.errors) ? data.errors : [];
			if (!config) mode = 'raw';
		} catch (err) {
			loadError = err?.message || 'Could not load config.yml.';
		} finally {
			loading = false;
		}
	}

	function showToast(kind, text, sticky = false) {
		toast = { kind, text };
		clearTimeout(toastTimer);
		if (!sticky) toastTimer = setTimeout(() => (toast = null), 5000);
	}

	function syncRaw() {
		if (!config) return;
		raw = configToYaml(config);
		rawErrors = [];
	}

	function onRawInput(event) {
		if (event?.currentTarget) raw = event.currentTarget.value;
		const result = parseConfigText(raw);
		rawErrors = result.errors;
		if (result.config) config = result.config;
	}

	function switchMode(next) {
		if (next === mode) return;
		if (next === 'visual') {
			const result = parseConfigText(raw);
			if (!result.ok) {
				rawErrors = result.errors;
				showToast('error', 'Fix the YAML errors before opening the visual editor.');
				return;
			}
			config = result.config;
			rawErrors = [];
		}
		mode = next;
	}

	function ensureFlatApps() {
		if (!config) return;
		if (isLegacyApps(config.apps)) config.apps = flattenApps(config.apps);
		if (!Array.isArray(config.apps)) config.apps = [];
	}

	function snapshot(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function buildForm(app) {
		return {
			id: app.id || '',
			name: app.name || '',
			url: app.url || '',
			icon: typeof app.icon === 'string' ? app.icon : '',
			description: typeof app.description === 'string' ? app.description : '',
			service: app.service === true,
			self_hosted: app.self_hosted === true,
			default_visible: app.default_visible !== false,
			groups: Array.isArray(app.groups) ? [...app.groups] : [],
			tags: Array.isArray(app.tags) ? [...app.tags] : [],
			app_store: {
				ios: typeof app.app_store?.ios === 'string' ? app.app_store.ios : '',
				android: typeof app.app_store?.android === 'string' ? app.app_store.android : ''
			},
			browser_extension: typeof app.browser_extension === 'string' ? app.browser_extension : ''
		};
	}

	// Opens the inspector on an existing row without asking: callers have
	// already decided that leaving the current buffer is safe.
	function openEditor(index) {
		ensureFlatApps();
		const app = config?.apps?.[index];
		if (!app) return;
		const iconIsObject = !!app.icon && typeof app.icon === 'object';
		const form = buildForm(app);
		editor = {
			index,
			idTouched: true,
			iconIsObject,
			originalIcon: iconIsObject ? app.icon : null,
			initialForm: snapshot(form),
			form,
			optionalOpen: !!(form.app_store.ios || form.app_store.android || form.browser_extension)
		};
		formError = '';
	}

	function confirmLeaveEditor() {
		if (!editor || !formDirty) return true;
		return confirm('Discard the unsaved changes to this entry?');
	}

	function selectApp(index) {
		if (editor?.index === index) return;
		if (!confirmLeaveEditor()) return;
		openEditor(index);
	}

	function startNew() {
		if (!confirmLeaveEditor()) return;
		ensureFlatApps();
		const form = {
			id: '',
			name: '',
			url: '',
			icon: '',
			description: '',
			service: false,
			self_hosted: false,
			default_visible: true,
			groups: [],
			tags: [],
			app_store: { ios: '', android: '' },
			browser_extension: ''
		};
		formError = '';
		editor = {
			index: null,
			idTouched: false,
			iconIsObject: false,
			originalIcon: null,
			initialForm: snapshot(form),
			form,
			optionalOpen: false
		};
	}

	function showDefaults() {
		if (!editor) return;
		if (!confirmLeaveEditor()) return;
		editor = null;
		formError = '';
	}

	function discardEditor() {
		if (!editor) return;
		if (!confirm('Discard the changes to this entry?')) return;
		editor.form = snapshot(editor.initialForm);
		editor.idTouched = true;
		formError = '';
	}

	function onNameInput(value) {
		if (!editor) return;
		editor.form.name = value;
		if (editor.index === null && !editor.idTouched) {
			editor.form.id = uniqueAppId(
				value,
				apps.map((app) => app.id).filter(Boolean)
			);
		}
	}

	function onIdInput(value) {
		if (!editor) return;
		editor.idTouched = true;
		editor.form.id = value;
	}

	function saveEditor() {
		if (!editor) return true;
		const form = editor.form;
		const id = form.id.trim();
		const name = form.name.trim();
		const url = form.url.trim();

		if (!name) {
			formError = 'Name is required.';
			return false;
		}
		if (!id) {
			formError = 'ID is required.';
			return false;
		}
		if (/\s/.test(id)) {
			formError = `ID must not contain spaces. Try "${slugifyId(id)}".`;
			return false;
		}
		if (!url) {
			formError = 'URL is required.';
			return false;
		}
		if (apps.some((app, index) => index !== editor.index && app.id === id)) {
			formError = `Another app already uses the id "${id}".`;
			return false;
		}

		ensureFlatApps();
		const original = editor.index !== null ? { ...config.apps[editor.index] } : {};
		const app = { ...original };
		app.id = id;
		app.name = name;
		app.url = url;

		if (form.icon.trim()) app.icon = form.icon.trim();
		else if (!editor.iconIsObject) delete app.icon;

		if (form.description.trim()) app.description = form.description.trim();
		else delete app.description;

		if (form.service) app.service = true;
		else delete app.service;
		if (form.self_hosted) app.self_hosted = true;
		else delete app.self_hosted;
		if (!form.default_visible) app.default_visible = false;
		else delete app.default_visible;

		if (form.groups.length) app.groups = [...form.groups];
		else delete app.groups;
		if (form.tags.length) app.tags = [...form.tags];
		else delete app.tags;

		const store = { ...(original.app_store || {}) };
		const ios = form.app_store.ios.trim();
		const android = form.app_store.android.trim();
		if (ios) store.ios = ios;
		else delete store.ios;
		if (android) store.android = android;
		else delete store.android;
		if (Object.keys(store).length) app.app_store = store;
		else delete app.app_store;

		if (form.browser_extension.trim()) app.browser_extension = form.browser_extension.trim();
		else delete app.browser_extension;

		const wasNew = editor.index === null;
		if (wasNew) config.apps.push(app);
		else config.apps[editor.index] = app;

		const target = wasNew ? config.apps.length - 1 : editor.index;
		syncRaw();
		// Keep the item selected so the inspector stays put; re-read it so the
		// buffer's baseline matches what was actually written to the draft.
		openEditor(target);
		showToast('ok', wasNew ? 'App added to the draft. Save Config to write config.yml.' : 'Entry updated in the draft. Save Config to write config.yml.');
		return true;
	}

	function deleteApp(index) {
		ensureFlatApps();
		const app = config?.apps?.[index];
		if (!app) return;
		if (!confirm(`Delete "${app.name || app.id}"? It is removed from config.yml when you save.`)) return;
		config.apps.splice(index, 1);
		if (editor) {
			if (editor.index === index) editor = null;
			else if (editor.index !== null && editor.index > index) editor.index -= 1;
		}
		syncRaw();
		showToast('ok', `Removed ${app.name || app.id} from the draft. Save Config to write config.yml.`);
	}

	function moveApp(index, delta) {
		ensureFlatApps();
		const target = index + delta;
		if (!config?.apps || target < 0 || target >= config.apps.length) return;
		const [item] = config.apps.splice(index, 1);
		config.apps.splice(target, 0, item);
		if (editor) {
			if (editor.index === index) editor.index = target;
			else if (editor.index === target) editor.index = index;
		}
		syncRaw();
	}

	function sectionOn(key) {
		const defaults = { search: true, changelog: true, update_check: true };
		const block = config?.[key];
		if (!block || typeof block !== 'object' || Array.isArray(block)) return defaults[key] === true;
		return block.enabled !== undefined ? block.enabled === true : defaults[key] === true;
	}

	function setSectionEnabled(key, value) {
		if (!config) return;
		const block = config[key];
		const current = block && typeof block === 'object' && !Array.isArray(block) ? block : {};
		config[key] = { ...current, enabled: value };
		syncRaw();
	}

	function setSearchField(field, value) {
		if (!config) return;
		const block = config.search;
		const current = block && typeof block === 'object' && !Array.isArray(block) ? block : {};
		const next = { ...current };
		if (value === '') delete next[field];
		else next[field] = value;
		config.search = next;
		syncRaw();
	}

	function backupLabel(backup) {
		if (!backup?.exists) return 'A backup is written beside holm.db before each save.';
		const when = backup.modified ? new Date(backup.modified).toLocaleString() : '';
		return `Backup: ${backup.path}${when ? ` (${when})` : ''}`;
	}

	async function focusError(err) {
		if (!err?.line) return;
		if (mode !== 'raw') {
			mode = 'raw';
			await tick();
		}
		if (!textareaEl) return;
		const lines = raw.split('\n');
		const index = Math.max(0, Math.min(lines.length - 1, err.line - 1));
		let offset = 0;
		for (let i = 0; i < index; i++) offset += lines[i].length + 1;
		const column = Math.max(0, (err.column || 1) - 1);
		const start = offset + column;
		const end = offset + (lines[index]?.length || 0);
		textareaEl.focus();
		textareaEl.setSelectionRange(start, Math.max(start, end));
		const lineHeight = parseFloat(getComputedStyle(textareaEl).lineHeight) || 18;
		textareaEl.scrollTop = Math.max(0, (index - 2) * lineHeight);
		syncScroll();
	}

	function syncScroll() {
		if (gutterEl && textareaEl) gutterEl.scrollTop = textareaEl.scrollTop;
	}

	function onRawKeydown(event) {
		if (event.key !== 'Tab') return;
		event.preventDefault();
		const element = event.currentTarget;
		const start = element.selectionStart;
		const end = element.selectionEnd;
		raw = `${raw.slice(0, start)}  ${raw.slice(end)}`;
		onRawInput();
		tick().then(() => {
			element.selectionStart = element.selectionEnd = start + 2;
		});
	}

	function discard() {
		if (!hasChanges) return;
		if (!confirm('Discard unsaved changes to config.yml?')) return;
		raw = savedRaw;
		const result = parseConfigText(raw);
		config = result.config;
		rawErrors = result.errors;
		editor = null;
		formError = '';
		showToast('ok', 'Unsaved changes discarded.');
	}

	// Called from the Configure header through bind:this. Any half-applied
	// inspector buffer is committed first so the header button never saves a
	// stale draft.
	export async function saveConfig() {
		if (!config || saving) return;
		if (editor && formDirty && !saveEditor()) return;

		const text = mode === 'visual' ? configToYaml(config) : raw;
		if (mode === 'visual') raw = text;

		const check = parseConfigText(text);
		if (!check.ok) {
			raw = text;
			rawErrors = check.errors;
			if (mode === 'visual') mode = 'raw';
			showToast('error', 'Fix the config errors before saving.', true);
			return;
		}

		saving = true;
		try {
			const response = await fetch('/api/admin/config', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ yaml: text })
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				if (Array.isArray(data.errors)) {
					rawErrors = data.errors;
					if (mode === 'visual') mode = 'raw';
				}
				if (data.readOnly) status = { ...status, writable: false };
				showToast('error', data.error || `Could not save config.yml (HTTP ${response.status}).`, true);
				return;
			}

			raw = data.raw ?? text;
			savedRaw = raw;
			config = data.config ?? check.config;
			rawErrors = [];
			status = {
				...status,
				path: data.path || status?.path,
				writable: data.writable !== false,
				backup: data.backup || status?.backup
			};
			if (editor) openEditor(editor.index);
			showToast('ok', 'Saved. Reloading so the dashboard picks up the new config…');
			try {
				await invalidateAll();
			} catch {
				/* the reload below still applies it */
			}
			setTimeout(() => {
				if (browser) window.location.reload();
			}, 1200);
		} catch (err) {
			showToast('error', `Could not save config.yml: ${err?.message || err}`, true);
		} finally {
			saving = false;
		}
	}
</script>

{#snippet toggleSwitch(on, onToggle, label)}
	<button
		type="button"
		class="switch"
		role="switch"
		aria-checked={on}
		aria-label={label}
		onclick={onToggle}
	>
		<span class="switch-track" class:on>
			<span class="switch-knob"></span>
		</span>
	</button>
{/snippet}

{#if loading}
	<div class="config-loading">Loading config.yml…</div>
{:else if loadError}
	<div class="notice danger">
		<strong>Could not load config.yml.</strong>
		<span>{loadError}</span>
		<button class="btn small" onclick={load}>Retry</button>
	</div>
{:else if status}
	<div class="config-tab" data-unsaved={hasChanges ? 'true' : undefined}>
		{#if toast}
			<div class="config-toast {toast.kind}" role="status">
				<span>{toast.text}</span>
				<button class="toast-close" onclick={() => (toast = null)} aria-label="Dismiss">&times;</button>
			</div>
		{/if}

		<div class="config-head">
			<div class="config-intro">
				<div class="config-title">Config</div>
				<p class="config-sub">
					Edit the live <code>config.yml</code>. Every save is validated, backed up beside <code>holm.db</code> and reloaded without restarting Holm.
				</p>
			</div>
			<div class="segmented" role="tablist" aria-label="Editor mode">
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'visual'}
					class="segmented-item"
					class:is-active={mode === 'visual'}
					onclick={() => switchMode('visual')}
				>Visual Editor</button>
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'raw'}
					class="segmented-item"
					class:is-active={mode === 'raw'}
					onclick={() => switchMode('raw')}
				>Raw YAML</button>
			</div>
		</div>

		<div class="status-strip">
			<span class="path" title={status.path}>{status.path}</span>
			<span class="pill {readOnly ? 'danger' : 'ok'}">{readOnly ? 'Read-only' : 'Writable'}</span>
			{#if hasChanges}<span class="pill warn">Unsaved changes</span>{/if}
			<span class="muted">{backupLabel(status.backup)}</span>
		</div>

		{#if readOnly}
			<div class="notice danger">
				<strong>config.yml is read-only.</strong>
				The editor can read <code>{status.path}</code> but cannot save. In Docker, change the volume from <code>:ro</code> to <code>:rw</code> and restart the container.
			</div>
		{/if}

		{#if errors.length}
			<div class="error-panel" role="alert">
				<div class="error-title">
					{errors.length} config problem{errors.length === 1 ? '' : 's'}
				</div>
				<ul>
					{#each errors as err, index (index)}
						<li>
							{#if err.line}
								<button type="button" class="error-link" onclick={() => focusError(err)}>
									Line {err.line}{err.column ? `:${err.column}` : ''}: {err.message}
								</button>
							{:else}
								<span>{err.message}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if mode === 'visual'}
			{#if legacy}
				<div class="notice">
					This file uses the legacy <code>category/items</code> app shape. The list below is flattened; saving from the visual editor writes the flat list.
				</div>
			{/if}

			<div class="split">
				<!-- Master: the entries, compact enough to scan. -->
				<aside class="master-pane" aria-label="Apps and services">
					<div class="master-tools">
						<input
							class="field"
							type="search"
							placeholder="Search apps, ids, groups or tags…"
							bind:value={search}
							aria-label="Search apps"
						/>
						<button class="btn primary" type="button" onclick={startNew}>+ Add</button>
					</div>

					<div class="filter-row" role="tablist" aria-label="Filter entries">
						{#each FILTERS as item (item.id)}
							<button
								type="button"
								role="tab"
								aria-selected={filter === item.id}
								class="filter-pill"
								class:is-active={filter === item.id}
								onclick={() => (filter = item.id)}
							>{item.label}</button>
						{/each}
						<span class="count">{filteredApps.length}</span>
					</div>

					<div class="master-list">
						{#each filteredApps as row (row.key)}
							<button
								type="button"
								class="app-row"
								class:is-active={editor?.index === row.index}
								onclick={() => selectApp(row.index)}
							>
								<span class="app-icon">
									<AppIcon
										icon={resolveIcon(row.app.icon)}
										name={row.app.name}
										size="w-5 h-5"
										wrapSize="w-8 h-8"
										wrap
									/>
								</span>
								<span class="app-main">
									<span class="app-name">{row.app.name || row.app.id || 'Untitled'}</span>
									<span class="app-meta">
										{#if row.app.tags?.[0]}
											<span class="chip">{row.app.tags[0]}</span>
										{:else}
											<span class="chip muted">No category</span>
										{/if}
									</span>
								</span>
								{#if row.app.service}
									<span class="pill service">Service</span>
								{/if}
							</button>
						{/each}

						{#if !filteredApps.length}
							<div class="empty">
								{apps.length ? 'No entries match that search or filter.' : 'No apps yet. Add your first one above.'}
							</div>
						{/if}

						<button
							type="button"
							class="defaults-row"
							class:is-active={!editor}
							onclick={showDefaults}
						>
							<span class="settings-glyph" aria-hidden="true">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
									<path d="M4 7h16M4 12h16M4 17h16" />
									<circle cx="9" cy="7" r="1.6" fill="currentColor" stroke="none" />
									<circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
									<circle cx="11" cy="17" r="1.6" fill="currentColor" stroke="none" />
								</svg>
							</span>
							<span class="app-main">
								<span class="app-name">Server defaults</span>
								<span class="app-meta"><span class="chip">Search &amp; features</span></span>
							</span>
						</button>
					</div>
				</aside>

				<!-- Detail: editor or server defaults, never both. -->
				<section class="inspector-pane" aria-label="Entry editor">
					{#if editor}
						<div class="inspector-head">
							<div class="inspector-titles">
								<span class="inspector-kicker">{editor.index === null ? 'New entry' : 'Editing'}</span>
								<span class="inspector-title">{editor.form.name || editor.form.id || 'Untitled'}</span>
							</div>
							<div class="inspector-tools">
								<button
									type="button"
									class="icon-btn"
									onclick={() => editor?.index !== null && moveApp(editor.index, -1)}
									disabled={editor.index === null || editor.index === 0}
									title="Move up"
									aria-label="Move entry up"
								>&uarr;</button>
								<button
									type="button"
									class="icon-btn"
									onclick={() => editor?.index !== null && moveApp(editor.index, 1)}
									disabled={editor.index === null || editor.index >= apps.length - 1}
									title="Move down"
									aria-label="Move entry down"
								>&darr;</button>
							</div>
						</div>

						<div class="inspector-body">
							{#if formError}<div class="notice danger">{formError}</div>{/if}

							<div class="group">
								<div class="group-head">Core details</div>
								<div class="form-grid">
									<label class="field-label span-2">
										<span>Name</span>
										<input
											class="field"
											type="text"
											value={editor.form.name}
											oninput={(event) => onNameInput(event.currentTarget.value)}
											placeholder="Jellyfin"
										/>
									</label>
									<label class="field-label span-2">
										<span>ID</span>
										<input
											class="field mono"
											type="text"
											value={editor.form.id}
											oninput={(event) => onIdInput(event.currentTarget.value)}
											placeholder="jellyfin"
										/>
										<span class="hint">Stable key used by user preferences. Auto-created from the name.</span>
									</label>
									<label class="field-label span-2">
										<span>URL</span>
										<input
											class="field"
											type="text"
											inputmode="url"
											bind:value={editor.form.url}
											placeholder="https://jellyfin.example.com"
										/>
									</label>
									<label class="field-label span-2">
										<span>Description</span>
										<textarea
											class="field"
											rows="2"
											bind:value={editor.form.description}
											placeholder="What this app is for. Shown under the card title on Portal and Services."
										></textarea>
									</label>
									<div class="field-block span-2">
										<span class="field-title">Icon URL</span>
										<div class="icon-row">
											<input
												class="field mono"
												type="text"
												bind:value={editor.form.icon}
												placeholder="di:jellyfin, si:jellyfin, or https://…"
											/>
											<span class="icon-preview" title="Icon preview">
												<AppIcon
													icon={previewIcon}
													name={editor.form.name || editor.form.id}
													size="w-6 h-6"
													wrapSize="w-9 h-9"
													wrap
												/>
											</span>
										</div>
										{#if editor.iconIsObject}
											<span class="hint">This app uses a <code>&#123;colored, mono&#125;</code> icon mapping. Leave the field blank to keep it, or type one icon to replace it.</span>
										{:else}
											<span class="hint">Dashboard Icons (<code>di:</code>), Simple Icons (<code>si:</code>), a full URL, or blank for a letter tile.</span>
										{/if}
									</div>
								</div>
							</div>

							<div class="group">
								<div class="group-head">Placement &amp; visibility</div>
								<div class="segmented full" role="radiogroup" aria-label="Entry type">
									<button
										type="button"
										role="radio"
										aria-checked={!editor.form.service}
										class="segmented-item"
										class:is-active={!editor.form.service}
										onclick={() => (editor.form.service = false)}
									>Portal App</button>
									<button
										type="button"
										role="radio"
										aria-checked={editor.form.service}
										class="segmented-item"
										class:is-active={editor.form.service}
										onclick={() => (editor.form.service = true)}
									>Service</button>
								</div>

								<div class="form-grid">
									<div class="field-block span-2">
										<span class="field-title">Tags</span>
										<TagInput
											bind:values={editor.form.tags}
											suggestions={tagSuggestions}
											placeholder="Add a tag…"
											label="App tags"
										/>
										<span class="hint">Ordered. The first tag is the category shown on the card and used for grouping.</span>
									</div>
									<div class="field-block span-2">
										<span class="field-title">Groups</span>
										<TagInput
											bind:values={editor.form.groups}
											suggestions={groupsSuggestions}
											placeholder="Add an OIDC group…"
											label="App groups"
										/>
										<span class="hint">Empty means everyone can see it. Users need at least one of these groups.</span>
									</div>
								</div>

								<div class="toggle-stack">
									<div class="toggle-row">
										<div>
											<span class="toggle-label">Default visible</span>
											<span class="hint">Place it on a new user's dashboard automatically.</span>
										</div>
										{@render toggleSwitch(editor.form.default_visible, () => (editor.form.default_visible = !editor.form.default_visible), 'Default visible')}
									</div>
									<div class="toggle-row">
										<div>
											<span class="toggle-label">Self-hosted</span>
											<span class="hint">List it in onboarding's self-hosted services.</span>
										</div>
										{@render toggleSwitch(editor.form.self_hosted, () => (editor.form.self_hosted = !editor.form.self_hosted), 'Self-hosted')}
									</div>
								</div>
							</div>

							<div class="group">
								<button
									type="button"
									class="group-toggle"
									aria-expanded={editor.optionalOpen}
									onclick={() => (editor.optionalOpen = !editor.optionalOpen)}
								>
									<span class="group-head inline">Optional links</span>
									<span class="group-note">App stores and browser extension</span>
									<span class="chevron" class:open={editor.optionalOpen} aria-hidden="true">&#9662;</span>
								</button>
								{#if editor.optionalOpen}
									<div class="form-grid">
										<label class="field-label span-2">
											<span>iOS App Store</span>
											<input class="field" type="text" inputmode="url" bind:value={editor.form.app_store.ios} placeholder="https://apps.apple.com/…" />
										</label>
										<label class="field-label span-2">
											<span>Android Play Store</span>
											<input class="field" type="text" inputmode="url" bind:value={editor.form.app_store.android} placeholder="https://play.google.com/…" />
										</label>
										<label class="field-label span-2">
											<span>Browser extension</span>
											<input class="field" type="text" inputmode="url" bind:value={editor.form.browser_extension} placeholder="https://…" />
										</label>
									</div>
								{/if}
							</div>
						</div>

						<div class="inspector-foot">
							<div class="foot-left">
								{#if editor.index !== null}
									<button class="btn danger" type="button" onclick={() => editor && deleteApp(editor.index)}>Delete</button>
								{/if}
							</div>
							<div class="foot-right">
								{#if formDirty}<span class="foot-note">Unsaved entry</span>{/if}
								<button class="btn ghost" type="button" disabled={!formDirty} onclick={discardEditor}>Discard</button>
								<button class="btn primary" type="button" disabled={!formDirty} onclick={saveEditor}>
									{editor.index === null ? 'Add to draft' : 'Save Changes'}
								</button>
							</div>
						</div>
					{:else}
						<div class="inspector-head">
							<div class="inspector-titles">
								<span class="inspector-kicker">Server defaults</span>
								<span class="inspector-title">Search &amp; feature switches</span>
							</div>
						</div>

						<div class="inspector-body">
							<div class="group">
								<div class="group-head">Web search</div>
								<div class="toggle-row">
									<div>
										<span class="toggle-label">Web search</span>
										<span class="hint">Show the search bar and submit web queries.</span>
									</div>
									{@render toggleSwitch(sectionOn('search'), () => setSectionEnabled('search', !sectionOn('search')), 'Web search')}
								</div>
								<div class="form-grid">
									<label class="field-label span-2">
										<span>Search URL</span>
										<input
											class="field mono"
											type="text"
											inputmode="url"
											value={config.search?.url ?? ''}
											oninput={(event) => setSearchField('url', event.currentTarget.value)}
											placeholder="https://www.google.com/search"
										/>
									</label>
									<label class="field-label">
										<span>Query parameter</span>
										<input
											class="field mono"
											type="text"
											value={config.search?.param ?? ''}
											oninput={(event) => setSearchField('param', event.currentTarget.value)}
											placeholder="q"
										/>
									</label>
									<label class="field-label">
										<span>Display name</span>
										<input
											class="field"
											type="text"
											value={config.search?.name ?? ''}
											oninput={(event) => setSearchField('name', event.currentTarget.value)}
											placeholder="Google"
										/>
									</label>
									<label class="field-label span-2">
										<span>Icon</span>
										<input
											class="field mono"
											type="text"
											value={config.search?.icon ?? ''}
											oninput={(event) => setSearchField('icon', event.currentTarget.value)}
											placeholder="di:google"
										/>
									</label>
								</div>
							</div>

							<div class="group">
								<div class="group-head">Features</div>
								<div class="toggle-stack">
									{#each SERVER_SECTIONS as section (section.key)}
										<div class="toggle-row">
											<div>
												<span class="toggle-label">{section.label}</span>
												<span class="hint">{section.hint}</span>
											</div>
											{@render toggleSwitch(sectionOn(section.key), () => setSectionEnabled(section.key, !sectionOn(section.key)), section.label)}
										</div>
									{/each}
								</div>
							</div>

							<div class="defaults-hint">
								Changes here stay in the draft until you use <strong>Save Config</strong> in the header.
							</div>
						</div>
					{/if}
				</section>
			</div>
		{:else}
			<div class="raw-pane">
				<div class="raw-head">
					<span class="hint">The raw file, exactly as on disk. Comments and formatting are preserved when you save from here.</span>
					<span class="raw-head-actions">
						<span class="hint">{lineCount} lines</span>
						<button class="btn ghost small" type="button" disabled={!dirty} onclick={discard}>Discard</button>
					</span>
				</div>
				<div class="raw-editor">
					<div class="raw-gutter" bind:this={gutterEl} aria-hidden="true">
						{#each lineNumbers as line}
							<div class="raw-line-number" class:error={errorLines.has(line)}>{line}</div>
						{/each}
					</div>
					<textarea
						class="raw-textarea"
						bind:this={textareaEl}
						bind:value={raw}
						oninput={onRawInput}
						onscroll={syncScroll}
						onkeydown={onRawKeydown}
						spellcheck="false"
						autocapitalize="off"
						autocomplete="off"
						wrap="off"
						aria-label="config.yml in YAML"
					></textarea>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.config-tab {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 0.65rem;
		height: 100%;
		min-height: 0;
		padding: 0.85rem 1rem;
	}
	.config-loading {
		padding: 2rem 0.5rem;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		text-align: center;
	}
	.config-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.config-intro {
		min-width: 0;
	}
	.config-title {
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 600;
	}
	.config-sub {
		max-width: 46rem;
		margin: 0.25rem 0 0;
		color: var(--text-dim);
		font-size: 0.7rem;
		line-height: 1.45;
	}
	.status-strip {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--input-bg);
		font-size: 0.66rem;
	}
	.status-strip .path {
		max-width: 100%;
		color: var(--text-muted);
		font-family: var(--font-mono, ui-monospace, monospace);
		overflow-wrap: anywhere;
	}
	.status-strip .muted {
		color: var(--text-dim);
		overflow-wrap: anywhere;
	}
	.segmented {
		display: inline-flex;
		gap: 0.15rem;
		padding: 0.15rem;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--input-bg);
	}
	.segmented.full {
		display: flex;
		width: 100%;
	}
	.segmented.full .segmented-item {
		flex: 1 1 0;
		text-align: center;
	}
	.segmented-item {
		padding: 0.35rem 0.7rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--text-dim);
		font-family: inherit;
		font-size: 0.7rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.segmented-item:hover {
		color: var(--text);
	}
	.segmented-item.is-active {
		background: var(--segment-on);
		color: var(--text);
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		gap: 0.75rem;
		flex: 1 1 auto;
		min-height: 0;
	}
	.master-pane,
	.inspector-pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border: 1px solid var(--glass-border);
		border-radius: 12px;
		background: var(--input-bg);
		overflow: hidden;
	}
	.master-tools {
		display: flex;
		gap: 0.4rem;
		padding: 0.55rem 0.55rem 0.35rem;
	}
	.master-tools .field {
		flex: 1 1 auto;
		min-width: 0;
	}
	.filter-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.55rem 0.5rem;
	}
	.filter-pill {
		padding: 0.22rem 0.6rem;
		border: 1px solid var(--glass-border);
		border-radius: 9999px;
		background: transparent;
		color: var(--text-dim);
		font-family: inherit;
		font-size: 0.66rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}
	.filter-pill:hover {
		color: var(--text);
	}
	.filter-pill.is-active {
		background: var(--segment-on);
		border-color: var(--pill-border);
		color: var(--text);
	}
	.filter-row .count {
		margin-left: auto;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.62rem;
	}
	.master-list {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		flex: 1 1 auto;
		min-height: 0;
		padding: 0 0.45rem 0.5rem;
		overflow-y: auto;
	}
	.app-row,
	.defaults-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		min-width: 0;
		padding: 0.42rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 9px;
		background: transparent;
		color: inherit;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.app-row:hover,
	.defaults-row:hover {
		background: var(--surface-card, var(--input-bg));
		border-color: var(--glass-border);
	}
	.app-row.is-active,
	.defaults-row.is-active {
		background: var(--segment-on);
		border-color: var(--pill-border);
	}
	.defaults-row {
		margin-top: 0.25rem;
		border-top: 1px solid var(--glass-border);
		border-radius: 9px;
	}
	.app-icon,
	.settings-glyph {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}
	.settings-glyph {
		width: 2rem;
		height: 2rem;
		border-radius: 22%;
		border: 1px solid var(--glass-border);
		background: var(--surface-card-strong, var(--input-bg));
	}
	.settings-glyph svg {
		width: 1rem;
		height: 1rem;
	}
	.app-main {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1 1 auto;
		min-width: 0;
	}
	.app-name {
		color: var(--text);
		font-size: 0.76rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.app-meta {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		overflow: hidden;
	}
	.chip {
		max-width: 100%;
		padding: 0.06rem 0.35rem;
		border: 1px solid var(--glass-border);
		border-radius: 9999px;
		color: var(--text-muted);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6rem;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip.muted {
		color: var(--text-dim);
		border-style: dashed;
	}
	.pill {
		flex: 0 0 auto;
		padding: 0.08rem 0.4rem;
		border: 1px solid var(--glass-border);
		border-radius: 9999px;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6rem;
		line-height: 1.35;
		white-space: nowrap;
	}
	.pill.ok {
		color: #4ade80;
		border-color: rgba(74, 222, 128, 0.35);
	}
	.pill.danger {
		color: #f87171;
		border-color: rgba(248, 113, 113, 0.35);
	}
	.pill.warn {
		color: #fbbf24;
		border-color: rgba(251, 191, 36, 0.35);
	}
	.pill.service {
		color: var(--text-muted);
		border-color: var(--pill-border);
		font-size: 0.56rem;
	}
	.inspector-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex: 0 0 auto;
		padding: 0.6rem 0.85rem;
		border-bottom: 1px solid var(--glass-border);
	}
	.inspector-titles {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.inspector-kicker {
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.58rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.inspector-title {
		color: var(--text);
		font-size: 0.82rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.inspector-tools {
		display: flex;
		gap: 0.25rem;
		flex: 0 0 auto;
	}
	.inspector-body {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		flex: 1 1 auto;
		min-height: 0;
		padding: 0.85rem;
		overflow-y: auto;
	}
	.inspector-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex: 0 0 auto;
		padding: 0.6rem 0.85rem;
		border-top: 1px solid var(--glass-border);
		background: var(--surface-card-strong, var(--input-bg));
	}
	.foot-left,
	.foot-right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.foot-right {
		justify-content: flex-end;
	}
	.foot-note {
		color: #fbbf24;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6rem;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--glass-border);
	}
	.group:last-child {
		padding-bottom: 0;
		border-bottom: none;
	}
	.group-head {
		color: var(--text-muted);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	.group-head.inline {
		flex: 0 0 auto;
	}
	.group-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}
	.group-note {
		color: var(--text-dim);
		font-size: 0.64rem;
		flex: 1 1 auto;
		min-width: 0;
	}
	.chevron {
		flex: 0 0 auto;
		color: var(--text-dim);
		font-size: 0.7rem;
		transition: transform 0.15s;
	}
	.chevron.open {
		transform: rotate(180deg);
	}
	.defaults-hint {
		padding: 0.55rem 0.65rem;
		border: 1px dashed var(--glass-border);
		border-radius: 8px;
		color: var(--text-dim);
		font-size: 0.66rem;
		line-height: 1.45;
	}
	.defaults-hint strong {
		color: var(--text-muted);
	}
	.empty {
		padding: 1.2rem 0.75rem;
		border: 1px dashed var(--glass-border);
		border-radius: 9px;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.68rem;
		text-align: center;
	}
	.btn {
		padding: 0.38rem 0.65rem;
		border: 1px solid var(--glass-border);
		border-radius: 8px;
		background: var(--input-bg);
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.7rem;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
	}
	.btn:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--pill-border);
	}
	.btn:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	.btn.primary {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--text);
		color: var(--bg);
		opacity: 0.9;
	}
	.btn.ghost {
		background: transparent;
	}
	.btn.small {
		padding: 0.24rem 0.45rem;
		font-size: 0.65rem;
	}
	.btn.danger {
		color: #f87171;
	}
	.btn.danger:hover:not(:disabled) {
		color: #fecaca;
		border-color: rgba(248, 113, 113, 0.45);
		background: rgba(248, 113, 113, 0.08);
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.55rem;
		height: 1.55rem;
		padding: 0;
		border: 1px solid var(--glass-border);
		border-radius: 6px;
		background: transparent;
		color: var(--text-dim);
		font-size: 0.72rem;
		cursor: pointer;
	}
	.icon-btn:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--pill-border);
	}
	.icon-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.field {
		width: 100%;
		min-width: 0;
		padding: 0.42rem 0.52rem;
		border: 1px solid var(--glass-border);
		border-radius: 8px;
		background: var(--input-bg);
		color: var(--text);
		font-family: inherit;
		font-size: 0.72rem;
		line-height: 1.4;
		outline: none;
		transition: border-color 0.15s;
	}
	.field:focus {
		border-color: var(--pill-border);
	}
	.field.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.7rem;
	}
	textarea.field {
		resize: vertical;
		min-height: 2.5rem;
	}
	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.55rem 0.65rem;
	}
	.span-2 {
		grid-column: 1 / -1;
	}
	.field-label,
	.field-block {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.field-label > span:first-child,
	.field-title {
		color: var(--text-muted);
		font-size: 0.66rem;
		font-weight: 600;
	}
	.hint {
		color: var(--text-dim);
		font-size: 0.62rem;
		line-height: 1.4;
	}
	.hint code,
	.config-sub code,
	.notice code {
		padding: 0.02rem 0.2rem;
		border-radius: 4px;
		background: var(--input-bg);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.94em;
	}
	.icon-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.icon-row .field {
		flex: 1 1 auto;
	}
	.icon-preview {
		flex: 0 0 auto;
		display: flex;
	}
	.toggle-stack {
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		overflow: hidden;
	}
	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.45rem 0.55rem;
		border-top: 1px solid var(--glass-border);
	}
	.toggle-row:first-child {
		border-top: none;
	}
	.toggle-row > div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.toggle-label {
		color: var(--text);
		font-size: 0.72rem;
		font-weight: 500;
	}
	.switch {
		flex: 0 0 auto;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}
	.switch-track {
		display: block;
		position: relative;
		width: 2.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		background: var(--toggle-off);
		transition: background 0.2s;
	}
	.switch-track.on {
		background: var(--toggle-on);
	}
	.switch-knob {
		position: absolute;
		top: 0.125rem;
		left: 0.125rem;
		width: 1rem;
		height: 1rem;
		border-radius: 9999px;
		background: var(--toggle-knob);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
		transition: transform 0.2s;
	}
	.switch-track.on .switch-knob {
		transform: translateX(1rem);
	}
	.raw-pane {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1 1 auto;
		min-height: 0;
	}
	.raw-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.raw-head-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.raw-editor {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		border: 1px solid var(--glass-border);
		border-radius: 10px;
		background: var(--bg);
		overflow: hidden;
	}
	.raw-gutter {
		flex: 0 0 auto;
		min-width: 2.2rem;
		padding: 0.6rem 0.35rem 0.6rem 0.45rem;
		border-right: 1px solid var(--glass-border);
		overflow: hidden;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.7rem;
		line-height: 1.5;
		text-align: right;
		user-select: none;
	}
	.raw-line-number.error {
		color: #f87171;
		font-weight: 700;
	}
	.raw-textarea {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		padding: 0.6rem 0.7rem;
		border: none;
		outline: none;
		resize: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.7rem;
		line-height: 1.5;
		white-space: pre;
		overflow: auto;
		tab-size: 2;
	}
	.notice {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--glass-border);
		border-left: 3px solid var(--pill-border);
		border-radius: 8px;
		background: var(--input-bg);
		color: var(--text-muted);
		font-size: 0.68rem;
		line-height: 1.45;
	}
	.notice.danger {
		border-left-color: #f87171;
		color: var(--text-muted);
	}
	.notice strong {
		color: var(--text);
	}
	.error-panel {
		max-height: 9rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid rgba(248, 113, 113, 0.35);
		border-left: 3px solid #f87171;
		border-radius: 8px;
		background: rgba(248, 113, 113, 0.06);
		overflow-y: auto;
	}
	.error-title {
		color: #fca5a5;
		font-size: 0.7rem;
		font-weight: 600;
	}
	.error-panel ul {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0.35rem 0 0;
		padding: 0;
		list-style: none;
	}
	.error-panel li {
		color: var(--text-muted);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.66rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.error-link {
		padding: 0;
		border: none;
		background: transparent;
		color: #fca5a5;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.error-link:hover {
		text-decoration: underline;
	}
	.config-toast {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex: 0 0 auto;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--glass-border);
		border-left: 3px solid #4ade80;
		border-radius: 8px;
		background: var(--surface-2, var(--input-bg));
		color: var(--text-muted);
		font-size: 0.68rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	.config-toast.error {
		border-left-color: #f87171;
	}
	.toast-close {
		padding: 0 0.25rem;
		border: none;
		background: transparent;
		color: var(--text-dim);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.toast-close:hover {
		color: var(--text);
	}
	@media (max-width: 900px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(10rem, 38%) minmax(0, 1fr);
			overflow-y: auto;
		}
		.master-pane,
		.inspector-pane {
			min-height: 0;
		}
	}
	@media (max-width: 640px) {
		.config-tab {
			padding: 0.65rem;
		}
		.form-grid {
			grid-template-columns: 1fr;
		}
		.span-2 {
			grid-column: auto;
		}
		.config-head {
			gap: 0.5rem;
		}
	}
</style>
