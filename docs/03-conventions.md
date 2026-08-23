# Trawler — Conventions

Binding for both codebases. Written against `edwinhern/express-typescript`
(three-tier, feature-first) and Next.js App Router.

Rule of thumb: **follow the boilerplate's grain.** Where a skill recommendation
and the boilerplate disagree, the boilerplate wins unless the deviation is
called out below with a reason.

---

# Part A — Backend (Express + TypeScript)

## A1. Directory layout

```
src/
├── modules/                      ← renamed from the boilerplate's `api/`
│   ├── healthCheck/
│   ├── auth/
│   │   ├── __tests__/
│   │   ├── authController.ts
│   │   ├── authModel.ts          ← zod schemas + inferred types + OpenAPI
│   │   ├── authRepository.ts
│   │   ├── authRouter.ts
│   │   ├── authService.ts
│   │   └── authTokens.ts         ← module-private helper
│   ├── torrent/
│   ├── event/                    ← SSE endpoint
│   ├── file/
│   ├── share/
│   ├── media/
│   ├── storage/
│   └── internal/                 ← forward_auth endpoint, NOT publicly routed
├── api-docs/                     ← zod-to-openapi generator
├── common/
│   ├── middleware/               ← errorHandler, rateLimiter, requestLogger,
│   │                                requireAuth
│   ├── models/                   ← serviceResponse.ts, errorCodes.ts
│   ├── types/                    ← express.d.ts augmentation
│   └── utils/                    ← commonValidation, envConfig, httpHandlers, logger
├── db/
│   ├── client.ts  schema.ts  migrate.ts  seed.ts
│   └── migrations/               ← drizzle-kit output, committed
├── integrations/                 ← qbittorrent/, ffmpeg/, caddyLog/
├── realtime/                     ← sseHub.ts, qbtPoller.ts
├── jobs/                         ← pg-boss bootstrap + handlers
├── index.ts
└── server.ts
```

**Why `modules/` and not the boilerplate's `api/`.** These folders hold domain
logic that pg-boss workers call directly — eviction, probing, share expiry never
touch HTTP. Naming them `api/` would claim they are the HTTP layer, which is
false; HTTP is one of two entry points.

**Flat modules, deliberately — no hexagonal sub-layers.** We are NOT adding
`application/ domain/ http/ infrastructure/` inside each module. Seven modules ×
5 files is 35 files; sub-layering turns that into 28 extra folders holding the
same 35 files. The dependency discipline hexagonal buys is already enforced by
§A2 — the repository *is* the port, Drizzle *is* the adapter. Hexagonal pays off
when adapters get swapped or many teams share a codebase; neither applies.

**Shared adapters live in `integrations/`, not inside a module.** qBittorrent is
used by `torrent`, `media` and `storage`; ffmpeg by `media` and `file`. An
adapter with three consumers is infrastructure, not a module's private detail.

**Feature folder names are singular** (`torrent/`, `share/`). **Route paths are
plural** (`/api/v1/torrents`).

If module boundaries ever need real enforcement, the cheap version is a Biome
rule banning cross-module imports except through a barrel — a config change, not
a refactor. Not worth it at one developer.

## A2. Layer contract

`Router → Controller → Service → Repository`. Dependencies point one way only.

| Layer | May do | May **not** do |
|---|---|---|
| `*Router.ts` | Define paths, attach `validateRequest`, register OpenAPI, attach middleware | Contain logic |
| `*Controller.ts` | Unwrap req, call one service method, hand back `ServiceResponse` | Touch the DB, contain business rules |
| `*Service.ts` | Business rules, orchestration, transactions, call integrations | Touch `req`/`res`, build SQL |
| `*Repository.ts` | Drizzle queries only | Contain business rules, call other services |
| `*Model.ts` | zod schemas, inferred types, OpenAPI registration | Anything executable |

A controller more than ~10 lines is doing a service's job. Cross-feature calls
go **service → service**, never controller → controller.

## A3. Validation

Every request boundary gets a zod schema in `*Model.ts`, applied via
`validateRequest`. No exceptions — the `node-express` profile marks unvalidated
input as `kill`.

Schemas registered with `zod-to-openapi` are what generate the frontend's types.
A missing schema is a missing frontend type — the incentive is aligned.

## A4. Response envelope

The boilerplate's `ServiceResponse`, extended with two fields:

```ts
class ServiceResponse<T = null> {
	readonly success: boolean;
	readonly message: string;
	readonly responseObject: T;
	readonly statusCode: number;
	readonly code?: string;       // ADDED: machine-readable, SCREAMING_SNAKE
	readonly requestId?: string;  // ADDED: attached by handleServiceResponse()
}
```

`message` is for humans and may change freely. **`code` is the contract** — the
frontend switches on `code`, never on `message`.

Error codes live once in `common/models/errorCodes.ts`:

| Code | Status |
|---|---|
| `VALIDATION_ERROR` | 400 |
| `AUTHENTICATION_REQUIRED` / `INVALID_CREDENTIALS` / `INVALID_TOKEN` / `TOKEN_EXPIRED` / `REFRESH_TOKEN_REUSED` | 401 |
| `PERMISSION_DENIED` / `SHARE_REVOKED` / `SHARE_PASSWORD_REQUIRED` | 403 |
| `RESOURCE_NOT_FOUND` / `SHARE_EXPIRED` | 404 |
| `TORRENT_ALREADY_EXISTS` | 409 |
| `SHARE_QUOTA_EXCEEDED` / `RATE_LIMIT_EXCEEDED` | 429 |
| `EGRESS_LIMIT_REACHED` | 503 |
| `QBITTORRENT_UNAVAILABLE` / `INTERNAL_ERROR` | 500 |

5xx never leaks an internal message. Log the detail, return "An unexpected error
occurred" plus `requestId`.

## A5. API surface

`/api/v1` prefix. Plural nouns, kebab-case, no verbs in paths.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` `/auth/refresh` `/auth/logout` | |
| `GET` | `/auth/me` | |
| `GET` | `/torrents` | offset pagination, `?status=&q=` |
| `POST` | `/torrents` | magnet; idempotent on infohash |
| `GET` `DELETE` | `/torrents/:id` | |
| `POST` | `/torrents/:id/pause` `/resume` `/recheck` `/pin` `/unpin` | actions where CRUD doesn't fit |
| `GET` | `/torrents/:id/files` | |
| `PATCH` | `/files/:id` | `{ priority }` |
| `GET` | `/files/:id/link` | → `{ url: "/dl/<token>/<name>" }` |
| `GET` | `/files/:id/stream` | direct-play redirect, or piped remux |
| `GET` `POST` | `/shares` | |
| `GET` `PATCH` `DELETE` | `/shares/:id` | DELETE = revoke, not row delete |
| `GET` | `/storage` | disk usage, watermarks, egress MTD |
| `GET` | `/events` | SSE — global stats + list deltas. Auth via the `ct_access` cookie, since `EventSource` cannot set headers |
| `GET` | `/torrents/:id/events` | SSE — detail telemetry, opened only while a detail view is mounted |
| `GET` | `/internal/authz` | **forward_auth only.** Never proxied by Caddy |

## A6. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | camelCase, suffixed by role | `torrentService.ts` |
| Module folder | `src/modules/<singular>/` | `src/modules/share/` |
| Classes | PascalCase | `QbittorrentClient` |
| Functions/vars | camelCase | `evictCandidates` |
| Constants | SCREAMING_SNAKE | `MAX_CONCURRENT_REMUX` |
| DB columns | snake_case | `last_accessed_at` |
| Env vars | SCREAMING_SNAKE, prefixed | `QBT_URL` |
| Job names | dot-namespaced | `storage.evict` |
| Routes | kebab-case plural | `/api/v1/torrents` |

## A7. Config

All env through the zod `envConfig`. Fail fast at boot — a missing var must crash
on start, never surface as a 500 at 2am. No `process.env` outside `envConfig.ts`.

**Docker compose `env_file` does NOT strip inline comments.** A value written as
`QBT_URL=http://x  # note` includes the comment. Keep comments on their own line.

## A8. Logging

pino NDJSON, structured, `requestId` on every line, echoed as `x-request-id`.

**Deliberately no `transport: pino-pretty`.** It runs in a worker thread via
thread-stream, which crashes under `tsx --watch` and takes the process with it.
For readable local logs: `pnpm start:dev | pnpm exec pino-pretty`.

**Redact `authorization`, `cookie`, `set-cookie`, `password`, `accessToken`, and
`magnet`.** A magnet reveals exactly what is being downloaded.

Levels: `error` = needs a human. `warn` = degraded but handled. `info` = state
transitions. `debug` = off in prod.

## A9. Jobs (pg-boss)

| Job | Schedule | Notes |
|---|---|---|
| `media.probe` | on demand | Enqueued when a file completes |
| `storage.evict` | every 5 min | Doc 02 §4 |
| `egress.ingest` | every 1 min | Tail Caddy access log |
| `share.expire` | hourly | Mark expired, release implicit pins |
| `db.backup` | nightly | `pg_dump` |
| `log.prune` | nightly | `share_access_log` older than 30 d |

Every handler is idempotent and takes its own advisory lock. Jobs run in the
`worker` container only.

The inverse also holds: **realtime pollers run in `api` only.** The 1 Hz
`sync/maindata` loop lives there because that is where the SSE connections are —
putting it in `worker` would force a Postgres `LISTEN/NOTIFY` hop per tick.

## A10. Testing

Vitest + Supertest, tests co-located in `__tests__/`.

**Deviation from the `node-express` profile**, which demands 0.7 coverage: target
**0.5, and only on `*Service.ts` + `*Repository.ts`**. Solo hobby project; 70%
across the whole tree buys ceremony, not safety.

Non-negotiable regardless of coverage:

- `shareRepository.isActive()` — every expiry/revocation/quota branch
- The eviction candidate query — **must never return a shared or pinned torrent**
- `/internal/authz` — path traversal, expired token, revoked share, over-quota
- Refresh-token rotation — replaying a spent token revokes the whole family
- `mapState()` — both `paused*` and `stopped*` spellings

## A11. Backend anti-patterns

| | Rule |
|---|---|
| kill | Any route without a zod schema |
| kill | Callback style — `async/await` throughout |
| kill | Express without explicit helmet + CORS allowlist |
| kill | Session cookies without `SameSite=Lax` |
| kill | Cookie-authenticating a non-GET request. `requireAuth` accepts `ct_access` **only on GET** — that is what makes CSRF moot while still letting `EventSource` authenticate |
| kill | Microservices, Kafka, Kubernetes |
| kill | Streaming file bytes through Node — Caddy serves bytes (doc 01 §5.4) |
| kill | `ffprobe` on the request path — probe once, cache in `media_probes` |
| kill | Transcoding HEVC — no hardware encoder on ARM Ampere |
| kill | `rm -rf` on torrent data — delete via the qBittorrent API |
| kill | Business logic in a controller |
| kill | Top-level `await` in a script — `tsx` emits CJS; wrap in `main()` |
| kill | Hard-coding qBittorrent's session cookie name — store it by value (v4 `SID` vs v5 `QBT_SID_<port>`) |
| warn | Raw SQL where Drizzle would do — allowed for the eviction query |
| warn | New npm dependency — check bundle/RAM cost first |

---

# Part B — Frontend (Next.js App Router)

## B1. Directory layout

```
app/
├── (dashboard)/                  ← auth-walled group
│   ├── layout.tsx  page.tsx
│   ├── torrents/[id]/page.tsx
│   ├── shares/page.tsx
│   └── settings/page.tsx
├── s/[shareId]/page.tsx          ← PUBLIC share landing, SSR
├── login/page.tsx
├── layout.tsx  providers.tsx  globals.css
components/
├── ui/                           ← our own primitives, no library
├── torrent/  share/  player/
lib/
├── api.ts  api-schema.d.ts       ← generated, never hand-edited
├── useTorrentStream.ts
├── format.ts  theme.ts  cn.ts
```

## B2. Server vs client components

RSC by default. `'use client'` **only** for event handlers, `useState`,
`useEffect`, or browser APIs. Practically: push `'use client'` to the leaves.

The dashboard is legitimately ~90% client components — it is a live table. That
is the correct use of Next here, not a compromise. Reserve RSC for the share
page, which is the one route that genuinely benefits.

## B3. Data fetching

- **Client components** — TanStack Query. The dashboard is genuinely live.
- **SSE** — one `useTorrentStream` hook writing into the Query cache. Do not
  poll *and* run SSE; SSE is the source of truth.
- **Cache-only reads** — a component that reads a cache entry something ELSE
  writes (the SSE stream, via `setQueryData`) must go through
  `lib/useCacheOnly.ts`. TanStack v5 requires a `queryFn` to EXIST even when
  `enabled: false`; omitting it throws at RUNTIME, not build time, so `tsc` and
  `next build` both pass and the page dies in the browser. `kill` on a bare
  `useQuery({ queryKey, enabled: false })`.
- **Cache shape** — the list holds **IDs only**; each torrent is its own entry
  at `["torrent", id]`. A 1 Hz update then re-renders one row, not the table.
- **Mutations** — `useMutation` + targeted `setQueryData`. Optimistic updates
  only for pin/unpin and priority, where a wrong guess is harmless.

## B4. Typed API client — no monorepo

The backend emits an OpenAPI 3 spec from its zod schemas. Generate from it:

```bash
pnpm gen:api    # openapi-typescript lib/openapi.json -o lib/api-schema.d.ts
```

End-to-end types with **no shared package and no monorepo plumbing**.
`axios` is banned — native `fetch` wrapped in `lib/api.ts`.

**The access token is memory-only, never `localStorage`** — that is readable by
any injected script. It is lost on reload and re-obtained from the httpOnly
refresh cookie, which is the entire point of the rotation design.

## B5. State

| Kind | Tool |
|---|---|
| Server state | TanStack Query |
| URL state (filters, pagination) | `useSearchParams` — the URL is the state |
| Local UI state | `useState` |
| Global client state | **None.** Add Zustand only when a real need appears |

## B6. Styling and components

**No component library — no shadcn, no Radix, no MUI.** We own every primitive
in `components/ui/`. At this size a library costs more in bundle and lock-in
than it saves.

**Colour tokens are the law.** Every raw colour value lives in `app/globals.css`
and nowhere else. Components use only token-derived Tailwind utilities
(`bg-surface`, `text-fg-muted`, `border-border`, `bg-status-completed-soft`, …).

- `kill` — any hex, `rgb()`, `hsl()` or `oklch()` literal in a `.tsx` file.
- `kill` — any default Tailwind palette class (`bg-slate-800`, `text-blue-500`).
  They do not respond to the theme and will look wrong in one mode.
- Sole sanctioned exception: `layout.tsx`'s `themeColor` metadata. The browser
  reads it from a `<meta>` tag to tint its own chrome before any CSS loads, so it
  cannot be a variable. Keep it in sync with `--ct-bg` by hand.

**Three theme states, all three handled.** `:root` is light; the dark palette is
redefined twice — under `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`.
The guard is what lets an explicit "light" choice survive a system set to dark.
`@theme inline` maps tokens to utilities *by reference*, which is what makes the
swap work at runtime rather than baking values at build time.

**Charts: load the `dataviz` skill first, and RUN its validator.** The four
categorical viz tokens (`--ct-viz-1..4`) are assigned in fixed order — 1 CPU,
2 memory, 3 network, 4 disk — and were validated with
`scripts/validate_palette.js` against both real surfaces (lightness band, chroma
floor, CVD separation, normal-vision floor, contrast). Do not hand-tune them;
re-run the validator. Non-negotiables that bit here: never a second y-axis (two
measures of different scale get two charts), a legend whenever a chart has ≥2
series, and every series directly labelled so identity is never colour-alone —
which is also what discharges the light-mode contrast WARN.

**Numbers use `.tabular`** (`font-variant-numeric: tabular-nums`) anywhere they
update live, or columns jitter at 1 Hz.

- Icons: **named imports** from `lucide-react`. Default imports are tree-shake
  hostile (`kill`).
- **Never `alert()` / `confirm()` / `prompt()`.** They ignore the theme, block
  the main thread, and cannot be styled. Use `components/ui/Dialog.tsx`, which
  wraps the native `<dialog>` element — focus trapping, Esc-to-close, `inert` on
  the background and top-layer stacking come free from the platform, so no
  portal and no focus-trap dependency. Destructive dialogs focus **Cancel**, not
  Confirm.
- Modal backdrops use a plain dim (`--ct-overlay`), never `backdrop-filter`. The
  table behind a modal is still repainting at 1 Hz; blurring it would
  re-rasterise the viewport every frame.
- Glassmorphism (`.glass`) is for the **public share page only** — never the
  dashboard. `backdrop-filter` forces the compositor to re-rasterise everything
  beneath it every frame, and the dashboard repaints at 1 Hz over a virtualised
  list. The utility degrades to a solid surface under
  `prefers-reduced-transparency`.

## B7. The share page is different

`/s/[shareId]` is the only public route and the only one with real constraints:

1. **SSR, not client-rendered** — it gets pasted into WhatsApp, Discord and
   Telegram, which fetch it server-side for a preview card.
2. **OG + Twitter meta required** via `generateMetadata`. This is the only reason
   we chose Next over a Vite SPA.
3. **`X-Robots-Tag: noindex`**, no public index, no sitemap entry.
4. Must render usefully on mobile-4G — the one route friends load on a phone.
5. Show "Open in VLC" whenever `playback = 'incompatible'`. Never a dead player.

## B8. Performance budgets

| Metric | Budget |
|---|---|
| Initial JS (dashboard) | < 200 KB gzip |
| Per-route JS | < 150 KB gzip |
| Dashboard LCP, desktop-fiber p75 | < 2000 ms |
| Share page LCP, mobile-4G p75 | < 2500 ms |
| INP p75 | < 200 ms |
| CLS p75 | < 0.1 |

> **Status after Phase 4: ~200 KB gzip total — AT the budget, not under.**
> ~152 KB of that is the React + Next + TanStack floor. Re-measure in Phase 9
> before adding the detail tabs, peers table and piece map.

Banned dependencies: `moment`, `lodash`, `axios`, `jquery`, `@mui/material`.

## B9. Frontend anti-patterns

| | Rule |
|---|---|
| kill | `'use client'` at a route root |
| kill | CSS-in-JS runtime libraries |
| kill | Default icon imports |
| kill | Client-rendering the share page |
| kill | `any` — `strict: true`, no `@ts-ignore` without a reason comment |
| kill | Hand-written API types duplicating the OpenAPI schema |
| kill | Access token in `localStorage` |
| kill | `alert()`, `confirm()`, `prompt()` — unthemeable and main-thread blocking |
| kill | `useQuery` with `enabled: false` and no `queryFn` — runtime throw, passes the build. Use `useCacheOnly` |
| kill | A leaked `EventSource` — hard-close on unmount, or the server keeps polling qBittorrent forever |
| warn | New global state — justify against `useState` + URL state first |
| warn | A skeleton for anything under 200 ms |

**Skipped deliberately** (`internal-tool` profile): design-system investment,
WCAG AAA, axe CI gates, Storybook, edge CDN, feature flags. We keep semantic
HTML, keyboard navigation and visible focus rings — the cheap 80%.

---

# Part C — Shared

## C1. Git

Conventional Commits:

```
feat(torrent): add sequential download on magnet add
fix(share): release implicit pin when share expires
chore(deps): bump drizzle-orm
docs: add db design
```

Branches: `feature/<name>`, `fix/<name>`, `docs/<name>`. Solo project — no PR
ceremony, but never commit straight to `main` for anything touching auth,
`/internal/authz`, or the eviction query.

## C2. Docker

**No anonymous `node_modules` volumes.** They survive image rebuilds, so adding a
dependency builds fine and then crashes the container with MODULE_NOT_FOUND
against the stale volume. Bind-mount only source directories (`/app/src`,
`/app/app`, …), never `/app` itself, and `node_modules` comes from the image as
intended. If you must recreate one: `--renew-anon-volumes`.

**Caddy does not hot-reload.** After editing a Caddyfile,
`docker compose restart caddy` — restarting only `api` leaves the old routes
serving, which looks exactly like a broken API.

## C3. Environment

`.env.example` committed and complete. `.env` never committed. Secrets are
generated, never chosen by hand: `openssl rand -base64 48`.

## C4. Definition of done

1. zod schema on every new request boundary
2. OpenAPI regenerated; frontend types regenerated (`pnpm gen:api`)
3. Tests for the non-negotiables in §A10 if touched
4. `pnpm biome check` clean
5. `tsc --noEmit` clean, no new `any`
6. Migration generated and committed if the schema changed
7. Docs 01–04 updated if a decision changed — **these docs are the contract**
