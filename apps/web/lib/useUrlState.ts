"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * The URL is the state (doc 03 §B5). Filters, sort and pagination live in the
 * query string so a view can be bookmarked, shared, and survives a reload or a
 * back button — none of which useState gives you.
 *
 * Writes use replace(), not push(): typing in a search box must not stack forty
 * history entries between you and the previous page.
 */
export function useUrlState<T extends Record<string, string | number | undefined>>(defaults: T) {
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();

	const state = useMemo(() => {
		const out = { ...defaults };
		for (const key of Object.keys(defaults) as Array<keyof T>) {
			const raw = params.get(String(key));
			if (raw === null) continue;
			out[key] = (typeof defaults[key] === "number" ? Number(raw) : raw) as T[keyof T];
		}
		return out;
	}, [params, defaults]);

	const setState = useCallback(
		(patch: Partial<T>) => {
			const next = new URLSearchParams(params.toString());
			for (const [key, value] of Object.entries(patch)) {
				// Defaults are omitted so a pristine view has a clean URL.
				if (value === undefined || value === "" || value === defaults[key as keyof T]) next.delete(key);
				else next.set(key, String(value));
			}
			const qs = next.toString();
			router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
		},
		[params, pathname, router, defaults],
	);

	return [state, setState] as const;
}
