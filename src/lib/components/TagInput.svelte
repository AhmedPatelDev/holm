<script>
	// A small pill editor for `groups` and `tags`. Enter or comma adds the
	// draft; Backspace in an empty draft removes the last pill; suggestions
	// come from values already used elsewhere in config.yml.
	let {
		values = $bindable([]),
		suggestions = [],
		placeholder = 'Add…',
		label = 'Values'
	} = $props();

	let draft = $state('');
	let focused = $state(false);

	const list = $derived(Array.isArray(values) ? values : []);
	const available = $derived(
		(Array.isArray(suggestions) ? suggestions : [])
			.filter((value) => typeof value === 'string' && value.trim() && !list.includes(value))
			.filter((value) => value.toLowerCase().includes(draft.trim().toLowerCase()))
			.slice(0, 8)
	);

	function add(value) {
		const next = String(value ?? '').trim();
		draft = '';
		if (!next || list.includes(next)) return;
		values = [...list, next];
	}

	function remove(index) {
		values = list.filter((_, i) => i !== index);
	}

	function onKeydown(event) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			add(draft);
		} else if (event.key === 'Backspace' && !draft && list.length) {
			remove(list.length - 1);
		} else if (event.key === 'Escape') {
			draft = '';
			event.currentTarget.blur();
		}
	}
</script>

<div class="tag-input" class:is-focused={focused}>
	<div class="tag-pills">
		{#each list as value, index (value)}
			<span class="tag-pill">
				<span>{value}</span>
				<button
					type="button"
					class="tag-remove"
					onclick={() => remove(index)}
					aria-label={`Remove ${value}`}
					title={`Remove ${value}`}
				>&times;</button>
			</span>
		{/each}
		<input
			class="tag-draft"
			type="text"
			{placeholder}
			aria-label={label}
			bind:value={draft}
			onkeydown={onKeydown}
			onfocus={() => (focused = true)}
			onblur={() => {
				focused = false;
				add(draft);
			}}
		/>
	</div>
	{#if focused && available.length}
		<div class="tag-suggestions">
			{#each available as value (value)}
				<button
					type="button"
					onmousedown={(event) => event.preventDefault()}
					onclick={() => add(value)}
				>{value}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tag-input {
		position: relative;
	}
	.tag-pills {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		min-height: 2.35rem;
		padding: 0.32rem 0.45rem;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--input-bg);
		transition: border-color 0.15s;
	}
	.tag-input.is-focused .tag-pills {
		border-color: var(--pill-border);
	}
	.tag-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		max-width: 100%;
		padding: 0.12rem 0.15rem 0.12rem 0.45rem;
		border: 1px solid var(--pill-border);
		border-radius: 9999px;
		background: var(--segment-on);
		color: var(--text-muted);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.68rem;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.tag-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		border: none;
		border-radius: 9999px;
		background: transparent;
		color: var(--text-dim);
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
	}
	.tag-remove:hover {
		background: var(--input-bg);
		color: var(--text);
	}
	.tag-draft {
		flex: 1 1 6rem;
		min-width: 4rem;
		padding: 0.1rem 0.2rem;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: inherit;
		font-size: 0.75rem;
	}
	.tag-draft::placeholder {
		color: var(--text-dim);
	}
	.tag-suggestions {
		position: absolute;
		z-index: 20;
		top: calc(100% + 0.25rem);
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		padding: 0.2rem;
		border: 1px solid var(--glass-border);
		border-radius: 9px;
		background: var(--surface-2, var(--input-bg));
		box-shadow: var(--shadow-theme, 0 10px 30px rgba(0, 0, 0, 0.35));
		max-height: 11rem;
		overflow-y: auto;
	}
	.tag-suggestions button {
		padding: 0.35rem 0.5rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		text-align: left;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.72rem;
		cursor: pointer;
	}
	.tag-suggestions button:hover {
		background: var(--input-bg);
		color: var(--text);
	}
</style>
