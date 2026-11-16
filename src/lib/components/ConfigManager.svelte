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
	let editorPanelEl = $state(null);

	const dirty = $derived(raw !== savedRaw);
	const hasChanges = $derived(dirty || !!editor);
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
	const canSave = $derived(
		!!config && (dirty || !!editor) && !errors.length && !readOnly && !saving && !loading
	);
	const previewIcon = $derived(
		editor
			? resolveIcon(editor.form.icon.trim() || (editor.iconIsObject ? editor.originalIcon : ''))
			: null
	);

	onMount(() => {
		load();
	});
	onDestroy(() => clearTimeout(toastTimer));

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

	async function revealEditor() {
		await tick();
		editorPanelEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	function startNew() {
		ensureFlatApps();
		formError = '';
		editor = {
			index: null,
			idTouched: false,
			iconIsObject: false,
			originalIcon: null,
			form: {
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
			}
		};
		revealEditor();
	}

	function editApp(index) {
		ensureFlatApps();
		const app = config?.apps?.[index];
		if (!app) return;
		const iconIsObject = !!app.icon && typeof app.icon === 'object';
		formError = '';
		editor = {
			index,
			idTouched: true,
			iconIsObject,
			originalIcon: iconIsObject ? app.icon : null,
			form: {
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
			}
		};
		revealEditor();
	}

	function closeEditor() {
		editor = null;
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

		editor = null;
		formError = '';
		syncRaw();
		showToast('ok', wasNew ? 'App added to the draft. Save to write config.yml.' : 'App updated in the draft. Save to write config.yml.');
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
		showToast('ok', `Removed ${app.name || app.id} from the draft. Save to write config.yml.`);
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
		if (!backup?.exists) return 'A .bak backup is written before each save.';
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

	async function save() {
		if (!config) return;
		if (editor && !saveEditor()) return;

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
			<div>
				<div class="config-title">Config</div>
				<p class="config-sub">
					Edit the live <code>config.yml</code>. Every save is validated, backed up, written atomically and reloaded without restarting Holm.
				</p>
			</div>
			<div class="head-actions">
				<button class="btn ghost" disabled={!hasChanges} onclick={discard}>Discard</button>
				<button class="btn primary" disabled={!canSave} onclick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
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

		<div class="mode-row">
			<div class="segmented" role="tablist" aria-label="Editor mode">
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'visual'}
					class="segmented-item"
					class:is-active={mode === 'visual'}
					onclick={() => switchMode('visual')}
				>Visual editor</button>
				<button
					type="button"
					role="tab"
					aria-selected={mode === 'raw'}
					class="segmented-item"
					class:is-active={mode === 'raw'}
					onclick={() => switchMode('raw')}
				>Raw YAML</button>
			</div>
			<span class="muted">{apps.length} app{apps.length === 1 ? '' : 's'} · {lineCount} lines</span>
		</div>

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

			<section class="panel">
				<div class="section-head">
					<div>
						<div class="section-title">Apps &amp; services</div>
						<p class="section-sub">Order here is the order on the dashboard. The first tag is the card category.</p>
					</div>
					<button class="btn" onclick={startNew}>+ Add app or service</button>
				</div>

				<div class="app-toolbar">
					<input
						class="field"
						type="search"
						placeholder="Search apps, ids, groups or tags…"
						bind:value={search}
						aria-label="Search apps"
					/>
					<select class="field" bind:value={filter} aria-label="Filter apps">
						<option value="all">All entries</option>
						<option value="portal">Portal</option>
						<option value="service">Services</option>
					</select>
				</div>

				<div class="app-list">
					{#each filteredApps as row (row.key)}
						<div class="app-row" class:is-editing={editor?.index === row.index}>
							<span class="order" title={`Position ${row.index + 1}`}>{row.index + 1}</span>
							<span class="app-icon">
								<AppIcon
									icon={resolveIcon(row.app.icon)}
									name={row.app.name}
									size="w-6 h-6"
									wrapSize="w-8 h-8"
									wrap
								/>
							</span>
							<div class="app-main">
								<div class="app-name">
									{row.app.name || row.app.id || 'Untitled'}
									<span class="app-id">{row.app.id || 'missing id'}</span>
								</div>
								<div class="app-meta">
									{#if row.app.tags?.[0]}
										<span class="chip">{row.app.tags[0]}</span>
									{:else}
										<span class="chip muted">no category</span>
									{/if}
									{#each (row.app.groups || []).slice(0, 3) as group, groupIndex (groupIndex)}
										<span class="chip group">{group}</span>
									{/each}
									{#if (row.app.groups || []).length > 3}
										<span class="chip">+{(row.app.groups || []).length - 3}</span>
									{/if}
								</div>
							</div>
							<span class="pill {row.app.service ? 'service' : 'portal'}">{row.app.service ? 'Service' : 'Portal'}</span>
							<div class="row-actions">
								<button
									class="icon-btn"
									onclick={() => moveApp(row.index, -1)}
									disabled={row.index === 0}
									title="Move up"
									aria-label={`Move ${row.app.name || row.app.id} up`}
								>&uarr;</button>
								<button
									class="icon-btn"
									onclick={() => moveApp(row.index, 1)}
									disabled={row.index === apps.length - 1}
									title="Move down"
									aria-label={`Move ${row.app.name || row.app.id} down`}
								>&darr;</button>
								<button class="btn small" onclick={() => editApp(row.index)}>Edit</button>
								<button class="btn small danger" onclick={() => deleteApp(row.index)}>Delete</button>
							</div>
						</div>
					{/each}
					{#if !filteredApps.length}
						<div class="empty">
							{apps.length ? 'No apps match that search or filter.' : 'No apps yet. Add your first one above.'}
						</div>
					{/if}
				</div>
			</section>

			{#if editor}
				<section class="panel app-editor" bind:this={editorPanelEl}>
					<div class="section-head">
						<div>
							<div class="section-title">
								{editor.index === null ? 'Add app or service' : `Edit ${editor.form.name || editor.form.id || 'app'}`}
							</div>
							<p class="section-sub">Changes stay in the draft until you apply them or save.</p>
						</div>
						<button class="btn ghost small" onclick={closeEditor}>Close</button>
					</div>

					{#if formError}<div class="notice danger">{formError}</div>{/if}

					<div class="form-grid">
						<label class="field-label">
							<span>Name</span>
							<input
								class="field"
								type="text"
								value={editor.form.name}
								oninput={(event) => onNameInput(event.currentTarget.value)}
								placeholder="Jellyfin"
							/>
						</label>
						<label class="field-label">
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
						<div class="field-block span-2">
							<span class="field-title">Icon</span>
							<div class="icon-row">
								<input
									class="field mono"
									type="text"
									bind:value={editor.form.icon}
									placeholder="di:jellyfin, si:jellyfin, or https://…"
								/>
								<span class="icon-preview">
									<AppIcon
										icon={previewIcon}
										name={editor.form.name || editor.form.id}
										size="w-7 h-7"
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
							<span class="field-title">Options</span>
							<div class="toggle-stack">
								<div class="toggle-row">
									<div>
										<span class="toggle-label">Service</span>
										<span class="hint">Show on the Services tab instead of Portal.</span>
									</div>
									{@render toggleSwitch(editor.form.service, () => (editor.form.service = !editor.form.service), 'Service')}
								</div>
								<div class="toggle-row">
									<div>
										<span class="toggle-label">Self-hosted</span>
										<span class="hint">List it in onboarding's self-hosted services.</span>
									</div>
									{@render toggleSwitch(editor.form.self_hosted, () => (editor.form.self_hosted = !editor.form.self_hosted), 'Self-hosted')}
								</div>
								<div class="toggle-row">
									<div>
										<span class="toggle-label">Default visible</span>
										<span class="hint">Place it on a new user's dashboard automatically.</span>
									</div>
									{@render toggleSwitch(editor.form.default_visible, () => (editor.form.default_visible = !editor.form.default_visible), 'Default visible')}
								</div>
							</div>
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
						<label class="field-label">
							<span>App Store (iOS)</span>
							<input class="field" type="text" inputmode="url" bind:value={editor.form.app_store.ios} placeholder="https://apps.apple.com/…" />
						</label>
						<label class="field-label">
							<span>App Store (Android)</span>
							<input class="field" type="text" inputmode="url" bind:value={editor.form.app_store.android} placeholder="https://play.google.com/…" />
						</label>
						<label class="field-label span-2">
							<span>Browser extension</span>
							<input class="field" type="text" inputmode="url" bind:value={editor.form.browser_extension} placeholder="https://…" />
						</label>
					</div>

					<div class="form-actions">
						<button class="btn ghost" onclick={closeEditor}>Cancel</button>
						<button class="btn primary" onclick={saveEditor}>
							{editor.index === null ? 'Add to draft' : 'Apply changes'}
						</button>
					</div>
				</section>
			{/if}

			<details class="panel server-defaults" open>
				<summary>Server defaults <span class="muted">search and feature switches</span></summary>
				<div class="default-body">
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
			</details>
		{:else}
			<div class="raw-head">
				<span class="hint">The raw file, exactly as on disk. Comments and formatting are preserved when you save from here.</span>
				<span class="hint">{lineCount} lines</span>
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
		{/if}

		<div class="config-foot">
			<span class="hint">Saving writes <code>config.yml.bak</code> first, then reloads the server config and refreshes this page.</span>
			<div class="head-actions">
				<button class="btn ghost" disabled={!hasChanges} onclick={discard}>Discard</button>
				<button class="btn primary" disabled={!canSave} onclick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.config-tab {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding-bottom: 0.5rem;
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
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.config-title {
		color: var(--text);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.config-sub {
		max-width: 44rem;
		margin: 0.2rem 0 0;
		color: var(--text-dim);
		font-size: 0.7rem;
		line-height: 1.45;
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.status-strip {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		min-width: 0;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--input-bg);
		font-size: 0.68rem;
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
	.mode-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.segmented {
		display: inline-flex;
		gap: 0.15rem;
		padding: 0.15rem;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--input-bg);
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
	.panel {
		padding: 0.75rem;
		border: 1px solid var(--glass-border);
		border-radius: 12px;
		background: var(--input-bg);
	}
	.section-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.65rem;
	}
	.section-title {
		color: var(--text);
		font-size: 0.78rem;
		font-weight: 600;
	}
	.section-sub {
		margin: 0.15rem 0 0;
		color: var(--text-dim);
		font-size: 0.68rem;
		line-height: 1.4;
	}
	.app-toolbar {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.55rem;
	}
	.app-toolbar .field {
		flex: 1 1 auto;
		min-width: 0;
	}
	.app-toolbar select.field {
		flex: 0 0 auto;
		width: auto;
	}
	.app-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.app-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
		padding: 0.45rem 0.5rem;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--surface-card, transparent);
	}
	.app-row.is-editing {
		border-color: var(--pill-border);
		background: var(--segment-on);
	}
	.order {
		width: 1.2rem;
		flex: 0 0 auto;
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.65rem;
		text-align: right;
	}
	.app-icon {
		flex: 0 0 auto;
		display: flex;
	}
	.app-main {
		flex: 1 1 auto;
		min-width: 0;
	}
	.app-name {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
		color: var(--text);
		font-size: 0.76rem;
		font-weight: 500;
	}
	.app-id {
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.65rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.app-meta {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
		margin-top: 0.18rem;
	}
	.chip {
		padding: 0.06rem 0.35rem;
		border: 1px solid var(--glass-border);
		border-radius: 9999px;
		color: var(--text-muted);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6rem;
		line-height: 1.3;
	}
	.chip.muted {
		color: var(--text-dim);
		border-style: dashed;
	}
	.chip.group {
		border-color: var(--pill-border);
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
	.pill.portal {
		color: var(--text-muted);
	}
	.pill.service {
		color: var(--text);
		border-color: var(--pill-border);
	}
	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex: 0 0 auto;
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
	select.field {
		cursor: pointer;
	}
	.app-editor {
		border-color: var(--pill-border);
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
	.notice code,
	.config-foot code {
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
	.form-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-top: 0.7rem;
	}
	.server-defaults summary {
		cursor: pointer;
		color: var(--text);
		font-size: 0.76rem;
		font-weight: 600;
	}
	.server-defaults summary .muted {
		color: var(--text-dim);
		font-size: 0.65rem;
		font-weight: 400;
	}
	.default-body {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		margin-top: 0.65rem;
	}
	.default-body .toggle-row {
		border: 1px solid var(--glass-border);
		border-radius: 9px;
	}
	.raw-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.raw-editor {
		display: flex;
		max-height: min(48vh, 30rem);
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
		min-height: 14rem;
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
		padding: 0.6rem 0.7rem;
		border: 1px solid rgba(248, 113, 113, 0.35);
		border-left: 3px solid #f87171;
		border-radius: 8px;
		background: rgba(248, 113, 113, 0.06);
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
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
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
	.config-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding-top: 0.1rem;
	}
	@media (max-width: 640px) {
		.form-grid {
			grid-template-columns: 1fr;
		}
		.span-2 {
			grid-column: auto;
		}
		.app-row {
			flex-wrap: wrap;
		}
		.app-main {
			flex: 1 1 calc(100% - 4rem);
		}
		.row-actions {
			width: 100%;
			justify-content: flex-end;
		}
		.app-toolbar {
			flex-direction: column;
		}
		.app-toolbar select.field {
			width: 100%;
		}
	}
</style>
