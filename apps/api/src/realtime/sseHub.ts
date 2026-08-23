import type { Response } from "express";
import { logger } from "@/common/utils/logger";

type Client = { id: number; res: Response; channel: string };

/**
 * SSE fan-out. Lives in the api process because that is where the connections
 * are — doc 01 §5.2. Single-replica assumption; two replicas would need
 * Postgres LISTEN/NOTIFY.
 */
class SseHub {
	private clients = new Map<number, Client>();
	private nextId = 1;
	private seq = 0;
	private heartbeat: NodeJS.Timeout | null = null;

	add(res: Response, channel: string): number {
		const id = this.nextId++;

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			// Tell any proxy not to buffer — a buffered SSE stream looks hung.
			"X-Accel-Buffering": "no",
		});
		res.write(": connected\n\n");
		if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") res.flushHeaders();

		this.clients.set(id, { id, res, channel });
		this.startHeartbeat();
		logger.debug({ clientId: id, channel, total: this.clients.size }, "sse client connected");
		return id;
	}

	remove(id: number) {
		this.clients.delete(id);
		if (this.clients.size === 0 && this.heartbeat) {
			clearInterval(this.heartbeat);
			this.heartbeat = null;
		}
	}

	/** Number of live subscribers on a channel — the poller uses this to decide
	 *  whether expensive per-torrent telemetry is worth fetching at all. */
	countFor(channel: string): number {
		let n = 0;
		for (const c of this.clients.values()) if (c.channel === channel) n++;
		return n;
	}

	broadcast(channel: string, event: string, data: unknown) {
		if (this.clients.size === 0) return;
		const payload = `id: ${++this.seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		for (const client of this.clients.values()) {
			if (client.channel !== channel) continue;
			try {
				client.res.write(payload);
			} catch {
				this.remove(client.id);
			}
		}
	}

	private startHeartbeat() {
		if (this.heartbeat) return;
		// Comment frames keep idle proxies from closing the connection.
		this.heartbeat = setInterval(() => {
			for (const client of this.clients.values()) {
				try {
					client.res.write(": ping\n\n");
				} catch {
					this.remove(client.id);
				}
			}
		}, 25_000);
		this.heartbeat.unref();
	}

	closeAll() {
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = null;
		for (const client of this.clients.values()) {
			try {
				client.res.end();
			} catch {
				/* already gone */
			}
		}
		this.clients.clear();
	}
}

export const sseHub = new SseHub();
export const GLOBAL_CHANNEL = "global";
export const torrentChannel = (id: string) => `torrent:${id}`;
