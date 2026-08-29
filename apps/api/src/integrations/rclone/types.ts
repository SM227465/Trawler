/** The subset of rclone's rc API this app uses. */

export interface RcRemote {
	name: string;
	type: string;
}

/** `config/get` — provider settings, with secrets already obscured by rclone. */
export type RcRemoteConfig = Record<string, string>;

export interface RcAbout {
	total?: number;
	used?: number;
	free?: number;
	trashed?: number;
	other?: number;
}

export interface RcJobStatus {
	id: number;
	finished: boolean;
	success: boolean;
	error: string;
	duration: number;
	startTime: string;
	endTime: string;
	output?: unknown;
}

export interface RcTransferStats {
	bytes: number;
	speed: number;
	transfers: number;
	errors: number;
	eta: number | null;
	transferring?: Array<{
		name: string;
		size: number;
		bytes: number;
		percentage: number;
		speed: number;
		eta: number | null;
	}>;
}

/** One entry from `operations/list`. */
export interface RcListEntry {
	Path: string;
	Name: string;
	Size: number;
	MimeType?: string;
	ModTime: string;
	IsDir: boolean;
}
