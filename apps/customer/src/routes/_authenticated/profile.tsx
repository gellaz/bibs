import { createFileRoute } from "@tanstack/react-router";
import { PersonalInfoForm } from "@/features/profile/personal-info-form";
import { ProfileIdentity } from "@/features/profile/profile-identity";

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
		</div>
	);
}
