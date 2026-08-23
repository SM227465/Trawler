"use client";
import { useEffect, useState } from "react";
import { COLUMNS } from "./grid";

const KEY = "ct-columns";

/** Name is never hideable — a row with no name is not a row. */
export const HIDEABLE = COLUMNS.filter((c) => c && c !== "Name") as string[];

/**
 * Which columns are visible, remembered per browser.
 *
 * Read AFTER mount, never during render: the server cannot know the preference,
 * and rendering the stored set first would mismatch the server HTML and
 * hydrate wrong.
 */
export function useColumns() {
	const [hidden, setHidden] = useState<Set<string>>(new Set());
	const [ready, setReady] = useState(false);

	useEffect(() => {
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
		} catch {
			/* private mode, or corrupt value — the default set is fine */
		}
		setReady(true);
	}, []);

	const toggle = (col: string) => {
		setHidden((prev) => {
			const next = new Set(prev);
			if (next.has(col)) next.delete(col);
			else next.add(col);
			try {
				localStorage.setItem(KEY, JSON.stringify([...next]));
			} catch {
				/* ignore */
			}
			return next;
		});
	};

	const reset = () => {
		setHidden(new Set());
		try {
			localStorage.removeItem(KEY);
		} catch {
			/* ignore */
		}
	};

	return { hidden, toggle, reset, ready, isVisible: (col: string) => !hidden.has(col) };
}
