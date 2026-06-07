import {
	type PersonalInfoCardLabels,
	PersonalInfoCard as SharedPersonalInfoCard,
} from "@bibs/ui/components/personal-info-card";
import { toast } from "@bibs/ui/components/sonner";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const LABELS: PersonalInfoCardLabels = {
	cardTitle: "Il mio profilo",
	cardDescription: "Aggiorna le tue informazioni personali",
	avatarEdit: "Modifica",
	firstName: "Nome",
	firstNamePlaceholder: "Mario",
	firstNameRequired: "Il nome è obbligatorio",
	lastName: "Cognome",
	lastNamePlaceholder: "Rossi",
	lastNameRequired: "Il cognome è obbligatorio",
	birthDate: "Data di nascita",
	save: "Salva modifiche",
	saving: "Salvataggio...",
	successUpdate: "Profilo aggiornato con successo",
	errorUpdate: "Errore durante il salvataggio. Riprova.",
	avatar: {
		title: "Immagine profilo",
		description: "Carica una foto e ritagliala in cerchio",
		chooseFile: "Scegli file",
		cropHelp: "Trascina per spostare, usa lo slider per ingrandire",
		save: "Salva",
		cancel: "Annulla",
		back: "Indietro",
		remove: "Rimuovi immagine",
		errorInvalidType: "Formato non supportato. Usa PNG, JPEG o WebP.",
		errorTooLarge: "File troppo grande. Massimo 5MB.",
		errorGeneric: "Errore durante il caricamento. Riprova.",
	},
};

export function PersonalInfoCard() {
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
		return { error: error?.message };
	};

	const onUploadAvatar = async (file: File) => {
		const res = await api().me.avatar.post({ file });
		if (res.error) {
			throw new Error(
				typeof res.error.value === "object" &&
					res.error.value &&
					"message" in res.error.value
					? String((res.error.value as { message: string }).message)
					: "Errore",
			);
		}
		await refetch();
		toast.success("Immagine profilo aggiornata");
	};

	const onRemoveAvatar = async () => {
		const res = await api().me.avatar.delete();
		if (res.error) {
			throw new Error(
				typeof res.error.value === "object" &&
					res.error.value &&
					"message" in res.error.value
					? String((res.error.value as { message: string }).message)
					: "Errore",
			);
		}
		await refetch();
		toast.success("Immagine profilo rimossa");
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
			labels={LABELS}
		/>
	);
}
