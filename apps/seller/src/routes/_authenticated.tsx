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
import { StoreSwitcher } from "@/components/store-switcher";
import { ActiveStoreProvider } from "@/hooks/use-active-store";
import { useSellerProfile } from "@/hooks/use-seller-profile";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated")({
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const {
		data: sellerProfile,
		isPending: profilePending,
		isError: profileError,
	} = useSellerProfile();
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		if (!sessionPending && !session) {
			void navigate({ to: "/login" });
		}
	}, [sessionPending, session, navigate]);

	// Check VAT verification status for sellers
	useEffect(() => {
		if (
			!sessionPending &&
			!profilePending &&
			session?.user.role === "seller" &&
			sellerProfile
		) {
			const isOnOnboardingPage = location.pathname === "/onboarding/pending";

			// Redirect to onboarding if VAT is not verified (and not already there)
			if (
				!isOnOnboardingPage &&
				(sellerProfile.vatStatus === "pending" ||
					sellerProfile.vatStatus === "rejected")
			) {
				void navigate({ to: "/onboarding/pending" });
			}
		}
	}, [
		sessionPending,
		profilePending,
		session,
		sellerProfile,
		navigate,
		location.pathname,
	]);

	// Show loading while checking session or seller profile (for sellers only)
	if (sessionPending || (session?.user.role === "seller" && profilePending)) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (!session) {
		return null;
	}

	// Handle seller profile error
	if (session.user.role === "seller" && profileError) {
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
						<div className="ml-auto">
							<StoreSwitcher />
						</div>
					</header>
					<div className="flex-1 p-4">
						<Outlet />
					</div>
				</SidebarInset>
			</SidebarProvider>
		</ActiveStoreProvider>
	);
}
