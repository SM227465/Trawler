"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type PublicUser, refreshSession, setAccessToken } from "@/lib/api";

interface AuthValue {
	user: PublicUser | null;
	ready: boolean;
	login: (email: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export const useAuth = () => {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used inside <Providers>");
	return ctx;
};

function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<PublicUser | null>(null);
	const [ready, setReady] = useState(false);
	const router = useRouter();

	// The access token is memory-only, so a reload always starts tokenless.
	// The httpOnly refresh cookie is what restores the session.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			if (await refreshSession()) {
				try {
					const me = await api.me();
					if (!cancelled) setUser(me);
				} catch {
					/* refresh worked but /me did not — treat as logged out */
				}
			}
			if (!cancelled) setReady(true);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const login = useCallback(async (email: string, password: string) => {
		const { accessToken, user: u } = await api.login(email, password);
		setAccessToken(accessToken);
		setUser(u);
	}, []);

	const logout = useCallback(async () => {
		await api.logout().catch(() => undefined);
		setAccessToken(null);
		setUser(null);
		router.push("/login");
	}, [router]);

	const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
	const [qc] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						// Live data arrives over SSE, so polling would be pure waste.
						refetchOnWindowFocus: false,
						refetchInterval: false,
						staleTime: 30_000,
						retry: 1,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={qc}>
			<AuthProvider>{children}</AuthProvider>
		</QueryClientProvider>
	);
}
