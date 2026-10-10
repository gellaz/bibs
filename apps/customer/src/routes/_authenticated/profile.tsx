import { createFileRoute } from "@tanstack/react-router";
import { PAGE_CONTAINER } from "@/components/page";
import { AddressBook } from "@/features/addresses/address-book";
import { PersonalInfoForm } from "@/features/profile/personal-info-form";
import { ProfileIdentity } from "@/features/profile/profile-identity";

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

/**
 * Identità, anagrafica e rubrica indirizzi su una pagina sola, larga quanto la
 * top bar: i campi si dispongono in riga e gli indirizzi in griglia invece di
 * allungare una colonna stretta.
 */
function ProfilePage() {
	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<ProfileIdentity />
			<PersonalInfoForm />
			<AddressBook />
		</div>
	);
}
