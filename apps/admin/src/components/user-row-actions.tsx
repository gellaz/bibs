import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	BanIcon,
	CopyIcon,
	MoreHorizontalIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

interface Props {
	userId: string;
	/** Display name used in the ban confirmation copy. */
	userName: string;
	banned: boolean;
	/**
	 * Disables the ban affordance — used for the currently signed-in admin so
	 * they can't lock themselves out. The menu still offers "Copia ID".
	 */
	canBan: boolean;
}

export function UserRowActions({ userId, userName, banned, canBan }: Props) {
	const queryClient = useQueryClient();
	const [confirmBanOpen, setConfirmBanOpen] = useState(false);

	const invalidate = () =>
		void queryClient.invalidateQueries({ queryKey: ["users"] });

	const banMutation = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.admin.banUser({ userId });
			if (error) throw new Error(error.message || "Errore durante il ban");
		},
		onSuccess: () => {
			invalidate();
			setConfirmBanOpen(false);
			toast.success("Utente bannato");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante il ban");
		},
	});

	const unbanMutation = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.admin.unbanUser({ userId });
			if (error) throw new Error(error.message || "Errore durante lo sblocco");
		},
		onSuccess: () => {
			invalidate();
			toast.success("Utente sbloccato");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante lo sblocco");
		},
	});

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label="Azioni utente">
						<MoreHorizontalIcon className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-auto">
					<DropdownMenuItem
						className="whitespace-nowrap"
						onSelect={async () => {
							try {
								await navigator.clipboard.writeText(userId);
								toast.success("ID copiato");
							} catch {
								toast.error("Impossibile copiare l'ID");
							}
						}}
					>
						<CopyIcon />
						Copia ID
					</DropdownMenuItem>

					{canBan && (
						<>
							<DropdownMenuSeparator />
							{banned ? (
								<DropdownMenuItem
									className="whitespace-nowrap"
									disabled={unbanMutation.isPending}
									onSelect={() => unbanMutation.mutate()}
								>
									<ShieldCheckIcon />
									Sblocca utente
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									variant="destructive"
									className="whitespace-nowrap"
									onSelect={() => setConfirmBanOpen(true)}
								>
									<BanIcon />
									Banna utente
								</DropdownMenuItem>
							)}
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog open={confirmBanOpen} onOpenChange={setConfirmBanOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Banna utente</AlertDialogTitle>
						<AlertDialogDescription>
							Sei sicuro di voler bannare <strong>{userName}</strong>? Verrà
							disconnesso da tutte le sessioni attive e non potrà più accedere
							finché non lo sblocchi.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={banMutation.isPending}>
							Annulla
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={(e) => {
								e.preventDefault();
								banMutation.mutate();
							}}
							disabled={banMutation.isPending}
						>
							{banMutation.isPending ? "Attendere..." : "Banna"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
