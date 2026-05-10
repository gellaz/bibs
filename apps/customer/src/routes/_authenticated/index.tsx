import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/")({
	component: Home,
});

function Home() {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<div className="text-center">
				<h1 className="font-display text-4xl font-medium">bibs</h1>
				<p className="mt-4 text-muted-foreground">
					Welcome to the customer app
				</p>
				<Link
					to="/profile"
					className="mt-4 inline-block text-primary underline"
				>
					Il mio profilo
				</Link>
			</div>
		</div>
	);
}
