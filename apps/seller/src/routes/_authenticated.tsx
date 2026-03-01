import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
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

	const role = session.user.role;
	if (role !== "seller" && role !== "employee") {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-4">
				<h1 className="text-2xl font-bold">Accesso negato</h1>
				<p className="text-muted-foreground">
					Solo i venditori possono accedere a questa area.
				</p>
				<button
					type="button"
					onClick={() =>
						void authClient.signOut().then(() => navigate({ to: "/login" }))
					}
					className="text-sm underline"
				>
					Esci e accedi con un altro account
				</button>
			</div>
		);
	}

	return <Outlet />;
}
