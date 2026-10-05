import { toast } from "@bibs/ui/components/sonner";
import {
	type PersonalInfoCardLabels,
	PersonalInfoCard as SharedPersonalInfoCard,
} from "@bibs/ui/custom/personal-info-card";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

// Funzione e non costante: i testi vanno letti a ogni render, dopo un cambio
// di lingua. I placeholder sono esempi di dato e restano italiani.
function personalInfoCardLabels(): PersonalInfoCardLabels {
	return {
		cardTitle: m.profile_personal_title(),
		cardDescription: m.profile_personal_description(),
		avatarEdit: m.common_edit(),
		firstName: m.common_first_name(),
		firstNamePlaceholder: "Mario",
		firstNameRequired: m.profile_first_name_required(),
		lastName: m.common_last_name(),
		lastNamePlaceholder: "Rossi",
		lastNameRequired: m.profile_last_name_required(),
		birthDate: m.common_birth_date(),
		save: m.common_save_changes(),
		saving: m.profile_saving(),
		successUpdate: m.profile_update_success(),
		errorUpdate: m.profile_update_error(),
		avatar: {
			title: m.profile_avatar_title(),
			description: m.profile_avatar_description(),
			chooseFile: m.profile_avatar_choose_file(),
			cropHelp: m.profile_avatar_crop_help(),
			save: m.common_save(),
			cancel: m.common_cancel(),
			back: m.common_back(),
			remove: m.profile_avatar_remove(),
			errorInvalidType: m.profile_avatar_invalid_type(),
			errorTooLarge: m.profile_avatar_too_large(),
			errorGeneric: m.profile_avatar_upload_error(),
		},
	};
}

function ProfilePage() {
	const { data: session, refetch } = authClient.useSession();
	const user = session?.user;

	const onSubmit = async (data: {
		firstName: string;
		lastName: string;
		birthDate: string | null;
	}) => {
		const { error } = await authClient.updateUser({
			firstName: data.firstName,
			lastName: data.lastName,
			// better-auth tipizza i campi additional come string|undefined ma
			// accetta e persiste null quando la chiave è presente nel body
			// (parseInputData scrive data[key] così com'è). Il cast esprime il
			// clear esplicito che il tipo inferito non sa rappresentare.
			birthDate: data.birthDate as unknown as string | undefined,
			name: `${data.firstName} ${data.lastName}`,
		});
		// Il `message` di better-auth è in inglese: si traduce dal `code`.
		return {
			error: error
				? authErrorMessage(error, m.profile_update_error())
				: undefined,
		};
	};

	const onUploadAvatar = async (file: File) => {
		const res = await api().me.avatar.post({ file });
		if (res.error) throw new Error(m.profile_avatar_upload_error());
		await refetch();
		toast.success(m.profile_avatar_updated());
	};

	const onRemoveAvatar = async () => {
		const res = await api().me.avatar.delete();
		if (res.error) throw new Error(m.common_error());
		await refetch();
		toast.success(m.profile_avatar_removed());
	};

	return (
		<SharedPersonalInfoCard
			values={{
				firstName: user?.firstName,
				lastName: user?.lastName,
				birthDate: user?.birthDate,
				image: user?.image,
				name: user?.name,
			}}
			onSubmit={onSubmit}
			onUploadAvatar={onUploadAvatar}
			onRemoveAvatar={onRemoveAvatar}
			labels={personalInfoCardLabels()}
			className="max-w-md"
		/>
	);
}
