import { Button } from "@bibs/ui/components/button";
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
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { AppSidebar } from "@/components/app-sidebar";
import { StoreBillingBanner } from "@/components/store-billing-banner";
import type { OnboardingStatus } from "@/db/schemas/seller";
import { ActiveStoreProvider } from "@/hooks/use-active-store";
import { useOnboardingStatus } from "@/hooks/use-onboarding";
import { useStores } from "@/hooks/use-stores";
import { authClient } from "@/lib/auth-client";

/** Map onboarding status → route the user should be on */
const ONBOARDING_ROUTES: Partial<Record<OnboardingStatus, string>> = {
	pending_email: "/onboarding/pending",
	pending_personal: "/onboarding/personal-info",
	pending_document: "/onboarding/document",
	pending_company: "/onboarding/company",
	pending_review: "/onboarding/pending",
	rejected: "/onboarding/pending", // no /rejected route yet — show pending page
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
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					Errore
				</h1>
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
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					Accesso negato
				</h1>
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

	// Employee: render via gate that shows empty state if no stores assigned
	if (role === "employee") {
		return <EmployeeStoreGate navigate={navigate} />;
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
					<header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
						<SidebarTrigger className="-ml-1" />
						<div aria-hidden className="h-4 w-px bg-border" />
						<AppBreadcrumb />
					</header>
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden p-4">
						<div className="mb-4 empty:hidden">
							<StoreBillingBanner />
						</div>
						<Outlet />
					</div>
				</SidebarInset>
			</SidebarProvider>
		</ActiveStoreProvider>
	);
}

function EmployeeStoreGate({
	navigate,
}: {
	navigate: ReturnType<typeof useNavigate>;
}) {
	const { data: stores, isLoading } = useStores();

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if ((stores ?? []).length === 0) {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center">
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					Nessun negozio assegnato
				</h1>
				<p className="text-muted-foreground max-w-md">
					Non sei ancora assegnato a nessun negozio. Contatta il titolare per
					ottenere l'accesso.
				</p>
				<Button
					variant="outline"
					onClick={() =>
						void authClient.signOut().then(() => navigate({ to: "/login" }))
					}
				>
					Esci
				</Button>
			</div>
		);
	}

	return (
		<ActiveStoreProvider>
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
						<SidebarTrigger className="-ml-1" />
						<div aria-hidden className="h-4 w-px bg-border" />
						<AppBreadcrumb />
					</header>
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden p-4">
						<div className="mb-4 empty:hidden">
							<StoreBillingBanner />
						</div>
						<Outlet />
					</div>
				</SidebarInset>
			</SidebarProvider>
		</ActiveStoreProvider>
	);
}
