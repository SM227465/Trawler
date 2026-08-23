export function PageHeader({ title, description }: { title: string; description?: string }) {
	return (
		<header>
			<h2 className="text-base font-semibold text-fg">{title}</h2>
			{description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
		</header>
	);
}
