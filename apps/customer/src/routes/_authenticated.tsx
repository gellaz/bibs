import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteHeader } from "@/components/site-header";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated")({
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = useNavigate();

	useEffect(() => {
		if (!isPending && !session) {
			void navigate({ to: "/login" });
		}
	}, [isPending, session, navigate]);

	if (isPending) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (!session) {
		return null;
	}

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<SiteHeader />
			<main className="flex-1">
				<Outlet />
			</main>
		</div>
	);
}
