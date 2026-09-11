import { AvatarUploadDialog } from "@bibs/ui/components/avatar-upload-dialog";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { toast } from "@bibs/ui/components/sonner";
import { UserAvatar } from "@bibs/ui/components/user-avatar";
import { unwrap } from "@bibs/ui/lib/api-client";
import { Camera } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";
import { useCustomerProfile } from "./use-customer-profile";

const LOCALE_TAGS: Record<string, string> = { it: "it-IT", en: "en-GB" };

/** "giugno 2026" — il mese per esteso, l'unità con cui si racconta un'iscrizione. */
function formatMonthYear(value: Date | string) {
	const date = value instanceof Date ? value : new Date(value);
	return new Intl.DateTimeFormat(LOCALE_TAGS[getLocale()] ?? "it-IT", {
		month: "long",
		year: "numeric",
	}).format(date);
}

/** Nome completo, poi il nome dell'account, poi la parte locale dell'email. */
function displayName(user: {
	firstName?: string | null;
	lastName?: string | null;
	name?: string | null;
	email: string;
}) {
	const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
	return full || user.name?.trim() || user.email.split("@")[0];
}

/**
 * Saldo punti: l'unico momento saffron della pagina (regola della Mano Sola).
 * A zero non c'è nessuna pill — una ricompensa che non esiste non si annuncia.
 */
function PointsPill({ points }: { points: number }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-saffron px-2.5 py-1 font-medium text-[0.8125rem] text-dusk leading-none tracking-[0.04em]">
			<span className="font-mono tabular-nums">{points}</span>
			{m.profile_points_label()}
		</span>
	);
}

/**
 * Chi sei, prima di cosa puoi modificare: avatar, nome in Satoshi, email, e la
 * riga di appartenenza (punti + membro da). È la "vetrina" del negozio applicata
 * alla persona — l'identità porta la pagina, il form la serve.
 *
 * L'affordance dell'avatar è permanente e non in hover: questa è la superficie
 * mobile-first, e un'area che si rivela al passaggio del mouse su touch non
 * esiste. Il bersaglio è l'avatar intero (80px), ben oltre i 44px.
 */
export function ProfileIdentity() {
	const { data: session, refetch } = authClient.useSession();
	const profile = useCustomerProfile();
	const [dialogOpen, setDialogOpen] = useState(false);
	const user = session?.user;

	if (!user) return null;

	const onUploadAvatar = async (file: File) => {
		const res = await api().me.avatar.post({ file });
		unwrap(res, m.error_generic());
		await refetch();
		toast.success(m.profile_avatar_updated_toast());
	};

	const onRemoveAvatar = async () => {
		const res = await api().me.avatar.delete();
		unwrap(res, m.error_generic());
		await refetch();
		toast.success(m.profile_avatar_removed_toast());
	};

	return (
		<>
			<section className="flex items-center gap-5 sm:gap-6">
				<button
					type="button"
					onClick={() => setDialogOpen(true)}
					aria-label={m.profile_avatar_edit()}
					className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<UserAvatar
						name={displayName(user)}
						image={user.image}
						className="size-20 text-2xl transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:opacity-90 motion-reduce:transition-none sm:size-24 sm:text-3xl"
					/>
					<span
						aria-hidden
						className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110 motion-reduce:transition-none sm:size-9"
					>
						<Camera className="size-4" />
					</span>
				</button>

				<div className="min-w-0">
					<h1 className="text-balance break-words font-bold font-display text-[clamp(1.5rem,4.5vw,2.125rem)] text-primary leading-[1.1] tracking-[-0.02em]">
						{displayName(user)}
					</h1>
					<p className="mt-1 truncate text-muted-foreground text-sm">
						{user.email}
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-muted-foreground text-sm">
						{profile.isPending ? (
							<>
								<Skeleton className="h-6 w-24 rounded-full" />
								<Skeleton className="h-4 w-36" />
							</>
						) : (
							profile.data && (
								<>
									{profile.data.points > 0 ? (
										<PointsPill points={profile.data.points} />
									) : (
										<span>{m.profile_points_empty()}</span>
									)}
									{/* Sotto sm la riga si spezza: il punto separatore resterebbe
									    appeso in fondo alla prima riga, quindi sparisce e il
									    "membro da" prende una riga sua. */}
									<span aria-hidden className="hidden opacity-40 sm:inline">
										&middot;
									</span>
									<span className="w-full sm:w-auto">
										{m.profile_member_since({
											date: formatMonthYear(profile.data.createdAt),
										})}
									</span>
								</>
							)
						)}
					</div>
				</div>
			</section>

			<AvatarUploadDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				currentImage={user.image}
				name={displayName(user)}
				onUpload={onUploadAvatar}
				onRemove={onRemoveAvatar}
				labels={{
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
				}}
			/>
		</>
	);
}
