import {
	type PersonalInfoCardLabels,
	PersonalInfoCard as SharedPersonalInfoCard,
} from "@bibs/ui/components/personal-info-card";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

function ProfilePage() {
	const { data: session, refetch } = authClient.useSession();
	const user = session?.user;

	// Chiamato dentro il componente (non a livello di modulo): m.*() legge il
	// locale corrente a runtime, un const module-level lo congelerebbe al
	// primo import.
	const labels: PersonalInfoCardLabels = {
		cardTitle: m.profile_title(),
		cardDescription: m.profile_description(),
		avatarEdit: m.profile_avatar_edit(),
		firstName: m.profile_first_name(),
		firstNamePlaceholder: m.profile_first_name_placeholder(),
		firstNameRequired: m.profile_first_name_required(),
		lastName: m.profile_last_name(),
		lastNamePlaceholder: m.profile_last_name_placeholder(),
		lastNameRequired: m.profile_last_name_required(),
		birthDate: m.profile_birth_date(),
		save: m.profile_save(),
		saving: m.profile_saving(),
		successUpdate: m.profile_success_update(),
		errorUpdate: m.profile_error_update(),
		avatar: {
			title: m.profile_avatar_title(),
			description: m.profile_avatar_description(),
			chooseFile: m.profile_avatar_choose_file(),
			cropHelp: m.profile_avatar_crop_help(),
			save: m.profile_avatar_save(),
			cancel: m.profile_avatar_cancel(),
			back: m.profile_avatar_back(),
			remove: m.profile_avatar_remove(),
			errorInvalidType: m.profile_avatar_error_invalid_type(),
			errorTooLarge: m.profile_avatar_error_too_large(),
			errorGeneric: m.profile_avatar_error_generic(),
		},
	};

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
		return { error: error?.message };
	};

	const onUploadAvatar = async (file: File) => {
		const res = await api().me.avatar.post({ file });
		if (res.error) throw new Error("Errore upload");
		await refetch();
		toast.success(m.profile_avatar_updated_toast());
	};

	const onRemoveAvatar = async () => {
		const res = await api().me.avatar.delete();
		if (res.error) throw new Error("Errore");
		await refetch();
		toast.success(m.profile_avatar_removed_toast());
	};

	return (
		<div className="flex min-h-screen items-center justify-center px-4 py-8">
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
				labels={labels}
				className="w-full max-w-md"
			/>
		</div>
	);
}
