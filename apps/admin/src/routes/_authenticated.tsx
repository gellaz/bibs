import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@bibs/ui/components/sidebar";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { AppSidebar } from "@/components/app-sidebar";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

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

	if (session.user.role !== "admin") {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-4">
				<h1 className="text-2xl font-bold">{m.shell_access_denied_title()}</h1>
				<p className="text-muted-foreground">{m.shell_access_denied_body()}</p>
				<button
					type="button"
					onClick={() =>
						void authClient.signOut().then(() => navigate({ to: "/login" }))
					}
					className="text-sm underline"
				>
					{m.shell_sign_out_other_account()}
				</button>
			</div>
		);
	}

	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
					<SidebarTrigger className="-ml-1" label={m.shell_sidebar_toggle()} />
					<div aria-hidden className="h-4 w-px bg-border" />
					<AppBreadcrumb />
				</header>
				{/* clip, non hidden: hidden ne fa un contenitore di scroll che
				    non scorre mai (scorre la finestra) e blocca ogni `sticky`. */}
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip p-4">
					<Outlet />
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
