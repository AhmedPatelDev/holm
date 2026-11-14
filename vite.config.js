import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

// The Configure modal's version link follows this fork's repository entry,
// so it needs no second place to update.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const repoUrl =
	(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '')
		.replace(/^git\+/, '')
		.replace(/\.git$/, '') || 'https://github.com/man15h/holm';

export default defineConfig(({ mode }) => {
	// Load all .env vars into process.env so server-side config.yml
	// ${VAR} substitution works in dev mode.
	const env = loadEnv(mode, process.cwd(), '');
	Object.assign(process.env, env);

	return {
		define: {
			__HOLM_REPO_URL__: JSON.stringify(repoUrl)
		},
		plugins: [tailwindcss(), sveltekit()],
		server: {
			host: true,
			allowedHosts: true
		}
	};
});
