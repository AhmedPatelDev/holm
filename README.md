# Holm (unofficial fork)

> **This is an unofficial fork of [Holm](https://github.com/man15h/holm), not the original project.**
>
> The application source currently tracks upstream. This fork publishes its own container image for personal deployments. For installation, configuration, integrations, releases and support, use the original project.

## Fork changes

- Publishes `ghcr.io/ahmedpateldev/holm` from `main`.
- Uses the fork image in [`docker-compose.yml`](docker-compose.yml).
- Replaces upstream's release workflow with a simple image publisher.
- Uses cross-platform npm scripts, so `npm run build` works on Windows too.
- Adds a two-tab dashboard: personal **Bookmarks** and a group-filtered **Portal**.
- Bookmarks support add/edit/delete, reordering, categories and card sizes, stored per user in SQLite with automatic favicons.
- Card density (compact/medium/wide) is configurable globally in Configure and per item.
- The dashboard runs wide by default (Layout width: Standard, Wide or Full in Configure → Appearance) with the clock, unified search and weather on one top row.
- Edit mode has an accent-coloured **Done** button and exits with `Esc`. "Open apps in new tab" defaults to off for new users.
- Adds five built-in dark themes — Obsidian, Amethyst, OLED Velvet, Tokyo Night and Emerald Noir — alongside Dynamic, Dark and Light, each persisted per user.
- Optional particle background (Constellation, Floating Dust, Starfield) powered by tsParticles, tinted from the active theme and persisted per user.
- A Text size slider in Configure → Appearance (85–130%) scales every rem-based size, persisted per user.
- Native select menus (bookmark Card size) follow the active theme instead of the OS light palette.

## Container image

Images are built for `linux/amd64` and `linux/arm64` and published to GitHub Container Registry:

```text
ghcr.io/ahmedpateldev/holm:latest
ghcr.io/ahmedpateldev/holm:sha-<short-commit>
```

`latest` follows the current `main` branch. The `sha-` tag pins one build. For official, versioned releases, use the upstream image `ghcr.io/man15h/holm:latest`.

## Docker Compose

```yaml
services:
  holm:
    image: ghcr.io/ahmedpateldev/holm:latest
    ports:
      - "3000:3000"
    environment:
      - CONFIG_PATH=/app/config.yml
      - DATABASE_PATH=/app/data/holm.db
      - NODE_ENV=production
      # - HOLM_SECRET_KEY=          # openssl rand -hex 32; encrypts integration logins
      # OIDC secrets:
      # - OIDC_CLIENT_ID=
      # - OIDC_CLIENT_SECRET=
    volumes:
      - ./config.yml:/app/config.yml:ro
      - holm-data:/app/data
    restart: unless-stopped

volumes:
  holm-data:
```

Copy [`config.minimal.yml`](config.minimal.yml) to `config.yml`, edit the apps, then run:

```bash
docker compose up -d
```

The minimal config has no sign-in: everyone who can reach the port shares one Guest page. Keep it on your own network. For per-person pages, groups and OIDC, use the `auth:` block from upstream's [`config.example.yml`](https://github.com/man15h/holm/blob/main/config.example.yml) and the [configuration docs](https://github.com/man15h/holm/blob/main/docs/configuration.md).

## Upstream

- Source, releases and issues: <https://github.com/man15h/holm>
- Configuration reference: <https://github.com/man15h/holm/blob/main/docs/configuration.md>
- Integrations: <https://github.com/man15h/holm/blob/main/docs/integrations.md>
- Upstream container image: `ghcr.io/man15h/holm:latest`

## License

[MIT](LICENSE)
