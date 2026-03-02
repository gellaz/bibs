export function PageHeader({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between">
			<div>
				<h1 className="text-2xl font-bold">{title}</h1>
				{description && (
					<p className="text-muted-foreground text-sm">{description}</p>
				)}
			</div>
			{children}
		</div>
	);
}
