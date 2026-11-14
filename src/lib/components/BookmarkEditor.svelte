<script>
	import { browser } from '$app/environment';
	import { dialog } from '$lib/actions/dialog.js';
	import { portal } from '$lib/actions/portal.js';
	import { validateBookmark } from '$lib/bookmarks.js';

	let {
		open = $bindable(false),
		bookmark = null,
		categories = [],
		defaultCategory = '',
		onsave,
		ondelete
	} = $props();

	let title = $state('');
	let url = $state('');
	let subtitle = $state('');
	let category = $state('');
	let iconUrl = $state('');
	let size = $state('');
	let errors = $state({});
	let formError = $state('');
	let busy = $state(false);
	let initializedFor = null;

	// Fill the form when a different bookmark (or a new one) opens.
	$effect(() => {
		if (!open) {
			initializedFor = null;
			formError = '';
			errors = {};
			return;
		}
		const key = bookmark?.id ?? 'new';
		if (initializedFor === key) return;
		initializedFor = key;
		title = bookmark?.title || '';
		url = bookmark?.url || '';
		subtitle = bookmark?.subtitle || '';
		category = bookmark?.category || defaultCategory || '';
		iconUrl = bookmark?.iconUrl || '';
		size = bookmark?.size || '';
		errors = {};
		formError = '';
	});

	$effect(() => {
		if (!browser || !open) return;
		function onKey(e) {
			if (e.key === 'Escape' && !busy) {
				e.preventDefault();
				open = false;
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	async function submit(e) {
		e.preventDefault();
		if (busy) return;
		const result = validateBookmark({ title, url, subtitle, category, iconUrl, size });
		errors = result.errors;
		formError = '';
		if (!result.ok) return;
		busy = true;
		try {
			await onsave(result.value);
			open = false;
		} catch (err) {
			formError = err?.message || 'Could not save the bookmark';
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!bookmark || busy) return;
		if (!confirm(`Delete “${bookmark.title}”?`)) return;
		busy = true;
		try {
			await ondelete(bookmark);
			open = false;
		} catch (err) {
			formError = err?.message || 'Could not delete the bookmark';
		} finally {
			busy = false;
		}
	}
</script>

{#if open}
	<div
		use:portal
		use:dialog={{ label: bookmark ? 'Edit bookmark' : 'Add bookmark', onclose: () => !busy && (open = false) }}
		class="fixed inset-0 modal-veil flex items-center justify-center z-[100] p-4"
	>
		<div class="glass-card rounded-2xl w-full max-w-[440px] max-h-[85vh] overflow-hidden shadow-theme animate-modal-enter flex flex-col">
			<div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border-card">
				<span class="text-[0.8rem] font-semibold text-content">{bookmark ? 'Edit bookmark' : 'Add bookmark'}</span>
				<button
					type="button"
					class="bg-transparent border-none text-content-dim text-2xl cursor-pointer leading-none hover:text-content w-6 h-6 flex items-center justify-center"
					onclick={() => (open = false)}
					disabled={busy}
					aria-label="Close"
				>&times;</button>
			</div>

			<form class="p-5 pt-4 overflow-y-auto flex flex-col gap-3.5" onsubmit={submit}>
				{#if formError}
					<div class="form-error" role="alert">{formError}</div>
				{/if}

				<label class="field">
					<span class="field-label">Title <em>*</em></span>
					<input class="field-input" bind:value={title} placeholder="My bookmarks" maxlength="120" />
					{#if errors.title}<span class="field-error">{errors.title}</span>{/if}
				</label>

				<label class="field">
					<span class="field-label">URL <em>*</em></span>
					<input class="field-input" bind:value={url} placeholder="https://example.com" inputmode="url" />
					{#if errors.url}<span class="field-error">{errors.url}</span>{/if}
				</label>

				<label class="field">
					<span class="field-label">Subtitle</span>
					<input class="field-input" bind:value={subtitle} placeholder="A short description" maxlength="240" />
					{#if errors.subtitle}<span class="field-error">{errors.subtitle}</span>{/if}
				</label>

				<label class="field">
					<span class="field-label">Category</span>
					<input
						class="field-input"
						bind:value={category}
						list="bookmark-category-list"
						placeholder="Uncategorized"
						maxlength="60"
					/>
					<datalist id="bookmark-category-list">
						{#each categories as c}<option value={c.name}></option>{/each}
					</datalist>
					<span class="field-hint">Pick an existing category or type a new name.</span>
					{#if errors.category}<span class="field-error">{errors.category}</span>{/if}
				</label>

				<label class="field">
					<span class="field-label">Icon URL</span>
					<input class="field-input" bind:value={iconUrl} placeholder="Leave blank to fetch the site icon" inputmode="url" />
					{#if errors.iconUrl}<span class="field-error">{errors.iconUrl}</span>{/if}
				</label>

				<label class="field">
					<span class="field-label">Card size</span>
					<select class="field-input" bind:value={size}>
						<option value="">Default</option>
						<option value="compact">Compact / Icon</option>
						<option value="medium">Medium / Standard</option>
						<option value="wide">Wide / Large</option>
					</select>
					{#if errors.size}<span class="field-error">{errors.size}</span>{/if}
				</label>

				<div class="flex items-center justify-between gap-2 pt-1">
					{#if bookmark}
						<button type="button" class="danger-btn" onclick={remove} disabled={busy}>Delete</button>
					{:else}
						<span></span>
					{/if}
					<div class="flex items-center gap-2">
						<button type="button" class="ghost-btn" onclick={() => (open = false)} disabled={busy}>Cancel</button>
						<button type="submit" class="save-btn" disabled={busy}>{busy ? 'Saving…' : bookmark ? 'Save' : 'Add'}</button>
					</div>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.field-label {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	.field-label em {
		font-style: normal;
		color: #f87171;
	}
	.field-input {
		width: 100%;
		background: var(--input-bg);
		border: 1px solid var(--glass-border);
		border-radius: 0.55rem;
		padding: 0.52rem 0.65rem;
		font: inherit;
		font-size: 0.8rem;
		color: var(--text);
		outline: none;
		transition: border-color 150ms ease;
	}
	.field-input:focus {
		border-color: var(--text-dim);
	}
	.field-input::placeholder {
		color: var(--text-dim);
	}
	.field-hint {
		font-size: 0.62rem;
		color: var(--text-dim);
		opacity: 0.85;
	}
	.field-error {
		font-size: 0.64rem;
		color: #fca5a5;
	}
	:global(.theme-light) .field-error {
		color: #b91c1c;
	}
	.form-error {
		font-size: 0.72rem;
		color: #fecaca;
		background: rgba(220, 38, 38, 0.16);
		border: 1px solid rgba(220, 38, 38, 0.35);
		border-radius: 0.55rem;
		padding: 0.5rem 0.65rem;
	}
	:global(.theme-light) .form-error {
		color: #991b1b;
		background: rgba(220, 38, 38, 0.08);
	}
	.save-btn,
	.ghost-btn,
	.danger-btn {
		font: inherit;
		font-size: 0.74rem;
		font-weight: 500;
		padding: 0.42rem 0.85rem;
		border-radius: 9999px;
		cursor: pointer;
		transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
	}
	.save-btn {
		border: 1px solid var(--text);
		background: var(--text);
		color: var(--surface, #09090b);
	}
	.save-btn:hover {
		opacity: 0.9;
	}
	.ghost-btn {
		border: 1px solid var(--glass-border);
		background: transparent;
		color: var(--text-dim);
	}
	.ghost-btn:hover {
		color: var(--text);
		border-color: var(--text-dim);
	}
	.danger-btn {
		border: 1px solid rgba(248, 113, 113, 0.35);
		background: transparent;
		color: #fca5a5;
	}
	.danger-btn:hover {
		background: rgba(220, 38, 38, 0.12);
	}
	:global(.theme-light) .danger-btn {
		color: #b91c1c;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
