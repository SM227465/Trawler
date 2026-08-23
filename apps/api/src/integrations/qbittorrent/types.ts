/** Shapes we actually consume from qBittorrent WebAPI v2. Not exhaustive. */

export interface QbtServerState {
	dl_info_speed?: number;
	dl_info_data?: number;
	up_info_speed?: number;
	up_info_data?: number;
	alltime_dl?: number;
	alltime_ul?: number;
	global_ratio?: string;
	dht_nodes?: number;
	/** "connected" | "firewalled" | "disconnected" — the best slow-torrent diagnostic. */
	connection_status?: string;
	free_space_on_disk?: number;
	total_peer_connections?: number;
	total_wasted_session?: number;
	use_alt_speed_limits?: boolean;
	dl_rate_limit?: number;
	up_rate_limit?: number;
	queued_io_jobs?: number;
	refresh_interval?: number;
}

export interface QbtTorrent {
	hash?: string;
	infohash_v1?: string;
	infohash_v2?: string;
	name?: string;
	size?: number;
	total_size?: number;
	progress?: number;
	dlspeed?: number;
	upspeed?: number;
	eta?: number;
	state?: string;
	num_seeds?: number;
	num_complete?: number;
	num_leechs?: number;
	num_incomplete?: number;
	ratio?: number;
	availability?: number;
	downloaded?: number;
	uploaded?: number;
	amount_left?: number;
	time_active?: number;
	seeding_time?: number;
	last_activity?: number;
	added_on?: number;
	completion_on?: number;
	category?: string;
	tags?: string;
	tracker?: string;
	trackers_count?: number;
	save_path?: string;
	content_path?: string;
	dl_limit?: number;
	up_limit?: number;
	seq_dl?: boolean;
	f_l_piece_prio?: boolean;
}

export interface QbtMainData {
	rid: number;
	full_update?: boolean;
	torrents?: Record<string, QbtTorrent>;
	torrents_removed?: string[];
	server_state?: QbtServerState;
}

export interface QbtFile {
	index?: number;
	name: string;
	size: number;
	progress: number;
	priority: number;
	is_seed?: boolean;
	availability?: number;
}

export interface QbtProperties {
	pieces_have?: number;
	pieces_num?: number;
	piece_size?: number;
	total_wasted?: number;
	nb_connections?: number;
	nb_connections_limit?: number;
	dl_speed_avg?: number;
	up_speed_avg?: number;
	reannounce?: number;
	creation_date?: number;
	created_by?: string;
	comment?: string;
	isPrivate?: boolean;
	seeds?: number;
	seeds_total?: number;
	peers?: number;
	peers_total?: number;
}

export interface QbtTracker {
	url: string;
	tier?: number;
	status: number;
	num_peers?: number;
	num_seeds?: number;
	num_leeches?: number;
	num_downloaded?: number;
	msg?: string;
}

export interface QbtPeer {
	ip?: string;
	port?: number;
	client?: string;
	country?: string;
	country_code?: string;
	connection?: string;
	flags?: string;
	flags_desc?: string;
	progress?: number;
	dl_speed?: number;
	up_speed?: number;
	downloaded?: number;
	uploaded?: number;
	relevance?: number;
	files?: string;
}

export interface QbtPeersSync {
	rid: number;
	full_update?: boolean;
	peers?: Record<string, QbtPeer>;
	peers_removed?: string[];
	show_flags?: boolean;
}
