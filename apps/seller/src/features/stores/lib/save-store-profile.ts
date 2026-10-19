import { m } from "@/paraglide/messages";

/**
 * Salvataggio della scheda Profilo: prima i campi, poi le foto nuove. Se il
 * caricamento fallisce si lancia, così chi chiama non svuota le foto scelte e
 * il seller può riprovare (i campi intanto sono salvati).
 */
export async function saveStoreProfile<Store, Image>({
	save,
	upload,
	files,
}: {
	save: () => Promise<Store>;
	/** null = caricamento fallito. */
	upload: (files: File[]) => Promise<Image[] | null>;
	files: File[];
}): Promise<{ store: Store; uploaded: Image[] }> {
	const store = await save();
	if (files.length === 0) return { store, uploaded: [] };
	const uploaded = await upload(files);
	if (!uploaded) throw new Error(m.store_update_images_warning());
	return { store, uploaded };
}
