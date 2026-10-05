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
import { richMessage } from "@/lib/rich-message";
import { m } from "@/paraglide/messages";

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
			if (error) throw new Error(error.message || m.users_ban_error());
		},
		onSuccess: () => {
			invalidate();
			setConfirmBanOpen(false);
			toast.success(m.users_ban_success());
		},
		onError: (error: Error) => {
			toast.error(error.message || m.users_ban_error());
		},
	});

	const unbanMutation = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.admin.unbanUser({ userId });
			if (error) throw new Error(error.message || m.users_unban_error());
		},
		onSuccess: () => {
			invalidate();
			toast.success(m.users_unban_success());
		},
		onError: (error: Error) => {
			toast.error(error.message || m.users_unban_error());
		},
	});

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label={m.users_actions_label()}
					>
						<MoreHorizontalIcon className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-auto">
					<DropdownMenuItem
						className="whitespace-nowrap"
						onSelect={async () => {
							try {
								await navigator.clipboard.writeText(userId);
								toast.success(m.users_id_copied());
							} catch {
								toast.error(m.users_copy_id_error());
							}
						}}
					>
						<CopyIcon />
						{m.users_copy_id()}
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
									{m.users_unban()}
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									variant="destructive"
									className="whitespace-nowrap"
									onSelect={() => setConfirmBanOpen(true)}
								>
									<BanIcon />
									{m.users_ban()}
								</DropdownMenuItem>
							)}
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog open={confirmBanOpen} onOpenChange={setConfirmBanOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{m.users_ban()}</AlertDialogTitle>
						<AlertDialogDescription>
							{richMessage(m.users_ban_description({ name: "{name}" }), {
								name: <strong>{userName}</strong>,
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={banMutation.isPending}>
							{m.common_cancel()}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={(e) => {
								e.preventDefault();
								banMutation.mutate();
							}}
							disabled={banMutation.isPending}
						>
							{banMutation.isPending
								? m.common_please_wait()
								: m.users_ban_confirm()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
