export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "ct-theme";

/**
 * Runs before paint, inlined in <head>. Without it the page renders in the
 * default theme for one frame and then snaps — the classic dark-mode flash.
 * Deliberately tiny and dependency-free.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
	try {
		if (theme === "system") localStorage.removeItem(THEME_KEY);
		else localStorage.setItem(THEME_KEY, theme);
	} catch {
		/* private mode — the choice just won't persist */
	}
}

export function readTheme(): Theme {
	try {
		const t = localStorage.getItem(THEME_KEY);
		if (t === "dark" || t === "light") return t;
	} catch {
		/* ignore */
	}
	return "system";
}
