import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, MapPin } from "lucide-react";
import { PersonalInfoForm } from "@/features/profile/personal-info-form";
import { ProfileIdentity } from "@/features/profile/profile-identity";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

/**
 * Identità in alto, anagrafica sotto — sulla stessa misura di lettura del
 * carrello. Niente centratura verticale: la pagina comincia dove comincia il
 * contenuto, non a metà di uno schermo vuoto.
 */
function ProfilePage() {
	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
			<ProfileIdentity />
			<PersonalInfoForm />

			<Link
				to="/addresses"
				className="mt-8 flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<MapPin className="size-5" aria-hidden />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block font-display font-semibold text-foreground">
						{m.profile_addresses_link()}
					</span>
					<span className="block text-muted-foreground text-sm">
						{m.profile_addresses_description()}
					</span>
				</span>
				<ChevronRight
					className="size-5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
			</Link>
		</div>
	);
}
