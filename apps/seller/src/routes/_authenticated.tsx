import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "@bibs/ui/components/breadcrumb";
import { Separator } from "@bibs/ui/components/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@bibs/ui/components/sidebar";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	createFileRoute,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ActiveStoreProvider } from "@/hooks/use-active-store";
import { useOnboardingStatus } from "@/hooks/use-onboarding";
import { authClient } from "@/lib/auth-client";

/** Map onboarding status → route the user should be on */
const ONBOARDING_ROUTES: Record<string, string> = {
	pending_email: "/onboarding/pending",
	pending_personal: "/onboarding/personal-info",
	pending_document: "/onboarding/document",
	pending_company: "/onboarding/company",
	pending_store: "/onboarding/store",
	pending_payment: "/onboarding/payment",
	pending_review: "/onboarding/pending",
	rejected: "/onboarding/pending",
};

export const Route = createFileRoute("/_authenticated")({
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const {
		data: onboarding,
		isPending: onboardingPending,
		isError: onboardingError,
	} = useOnboardingStatus();
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		if (!sessionPending && !session) {
			void navigate({ to: "/login" });
		}
	}, [sessionPending, session, navigate]);

	// Redirect sellers to the correct onboarding step
	useEffect(() => {
		if (
			!sessionPending &&
			!onboardingPending &&
			session?.user.role === "seller" &&
			onboarding
		) {
			const status = onboarding.onboardingStatus;
			const targetRoute = ONBOARDING_ROUTES[status];

			if (targetRoute) {
				// Seller is not yet active — redirect to the correct step
				const isOnOnboardingPage = location.pathname.startsWith("/onboarding");
				if (!isOnOnboardingPage || location.pathname !== targetRoute) {
					void navigate({ to: targetRoute });
				}
			} else if (
				status === "active" &&
				location.pathname.startsWith("/onboarding")
			) {
				// Seller completed onboarding but is still on an onboarding page
				void navigate({ to: "/" });
			}
		}
	}, [
		sessionPending,
		onboardingPending,
		session,
		onboarding,
		navigate,
		location.pathname,
	]);

	// Show loading while checking session or onboarding status (for sellers only)
	if (
		sessionPending ||
		(session?.user.role === "seller" && onboardingPending)
	) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (!session) {
		return null;
	}

	// Handle onboarding error
	if (session.user.role === "seller" && onboardingError) {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-4">
				<h1 className="text-2xl font-bold">Errore</h1>
				<p className="text-muted-foreground">
					Impossibile caricare il profilo venditore.
				</p>
				<button
					type="button"
					onClick={() =>
						void authClient.signOut().then(() => navigate({ to: "/login" }))
					}
					className="text-sm underline"
				>
					Esci e accedi nuovamente
				</button>
			</div>
		);
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

	// If seller is still onboarding, render outlet without sidebar
	if (
		role === "seller" &&
		onboarding &&
		onboarding.onboardingStatus !== "active"
	) {
		return <Outlet />;
	}

	return (
		<ActiveStoreProvider>
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
						<SidebarTrigger className="-ml-1" />
						<Separator orientation="vertical" className="mr-2 h-4" />
						<Breadcrumb>
							<BreadcrumbList>
								<BreadcrumbItem>
									<BreadcrumbPage>Bibs Seller</BreadcrumbPage>
								</BreadcrumbItem>
							</BreadcrumbList>
						</Breadcrumb>
					</header>
					<div className="flex-1 p-4">
						<Outlet />
					</div>
				</SidebarInset>
			</SidebarProvider>
		</ActiveStoreProvider>
	);
}
