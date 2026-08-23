# Phase 0 spike — Caddy `forward_auth` internal redirect

**Result: VERIFIED. Caddy can do it. We do not need nginx `X-Accel-Redirect`.**

Run: `docker compose up -d` then `curl -s localhost:8099/dl/smalltoken/x.txt`

## Verified on 2026-08-22

| Check | Result |
|---|---|
| Valid token → file served | 200 ✅ |
| Revoked / unknown token | 403 ✅ |
| HTTP Range | 206, correct `Content-Range`, byte-exact ✅ |
| `Accept-Ranges: bytes` advertised | ✅ |
| Path traversal (4 encodings) | no leak ✅ |
| authz container down | 502, zero bytes — **fails closed** ✅ |
| Throughput, 512 MB | **1.6 GB/s** (~13 Gbps) ✅ |

Throughput is ~48% of this machine's raw `dd` disk read (3.4 GB/s) and roughly
100× any realistic WAN link — proof the bytes go out via Caddy's `sendfile`
path and never touch Node.

## Finding 1 — `route` is mandatory

The first attempt returned 403 for every request, including valid tokens.

Cause: inside a `handle` block, Caddy **sorts directives by its own priority
table** rather than the order written. `rewrite` outranks `forward_auth`, so the
rewrite executed first against an as-yet-unset `X-Accel-Path` header, blanking
the URI to `/` before auth ever saw it. The authz service received
`X-Forwarded-Uri: /`, found no token, and denied.

Wrapping the three directives in `route { }` preserves written order and fixes
it. **This is the single non-obvious thing about the whole design.**

## Finding 2 — the URL suffix after the token is cosmetic

`/dl/goodtoken/anything-at-all.mp4` serves whatever path the authz service
returned. The client cannot influence the path — only the token selects it, so
traversal is *structurally* impossible rather than filtered.

This is a feature: put the real filename in the URL
(`/dl/<token>/Movie.2024.mkv`) and the browser names the download correctly with
no `Content-Disposition` header needed.

## The working config

```caddyfile
handle /dl/* {
	route {
		forward_auth api:3000 {
			uri /internal/authz
			copy_headers X-Accel-Path
		}
		rewrite * {http.request.header.X-Accel-Path}
		file_server {
			root /data/downloads
		}
	}
}
```

The authz service reads `X-Forwarded-Uri` (Caddy also sends
`X-Forwarded-Method`, `-Host`, `-Proto`, `-For`), maps token → real path, and
replies `200` + `X-Accel-Path`, or `403`.
