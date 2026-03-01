import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function BetterAuthHeader() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = useNavigate();

	if (isPending || !session?.user) {
		return null;
	}

	return (
		<div className="flex items-center gap-2">
			<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
				<span className="text-xs font-medium">
					{session.user.name?.charAt(0).toUpperCase() || "U"}
				</span>
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm font-medium">
					{session.user.name}
				</span>
				<span className="truncate text-xs text-muted-foreground">
					{session.user.email}
				</span>
			</div>
			<button
				type="button"
				onClick={() => {
					void authClient.signOut().then(() => navigate({ to: "/login" }));
				}}
				className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
				title="Esci"
			>
				<LogOut className="size-4" />
			</button>
		</div>
	);
}
