import { Activity, ArrowDownUp, FolderTree, HardDrive, ScrollText, Share2, SlidersHorizontal } from "lucide-react";

/**
 * One section per concern. The dashboard previously stacked transfers, storage
 * and policy on one page, which stopped scanning as anything at all.
 */
export const SECTIONS = [
	{ href: "/", label: "Transfers", icon: ArrowDownUp, hint: "Active and completed torrents" },
	{ href: "/storage", label: "Storage", icon: HardDrive, hint: "Disk usage and cleanup" },
	{ href: "/files", label: "File access", icon: FolderTree, hint: "Mount your downloads over WebDAV" },
	{ href: "/shares", label: "Shares", icon: Share2, hint: "Links you have handed out" },
	{ href: "/settings", label: "Settings", icon: SlidersHorizontal, hint: "Speed and seeding limits" },
	{ href: "/activity", label: "Activity", icon: ScrollText, hint: "What has changed on this box" },
	{ href: "/system", label: "System", icon: Activity, hint: "Host health and services" },
] as const;
