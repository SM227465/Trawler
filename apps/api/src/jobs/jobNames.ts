/**
 * Dot-namespaced job names (doc 03 §A6). Constants, not string literals at the
 * call site: a typo in `boss.send()` would otherwise queue into a queue nothing
 * is working, and fail silently forever.
 */
export const JOB = {
	STORAGE_EVICT: "storage.evict",
	MEDIA_PROBE: "media.probe",
	EGRESS_INGEST: "egress.ingest",
	SHARE_EXPIRE: "share.expire",
	DB_BACKUP: "db.backup",
	LOG_PRUNE: "log.prune",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];
