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
import { AvatarBadge } from "@bibs/ui/components/avatar";
import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@bibs/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Skeleton } from "@bibs/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { UserAvatar } from "@bibs/ui/components/user-avatar";
import { cn } from "@bibs/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CheckIcon,
	MoreHorizontalIcon,
	PencilIcon,
	SendIcon,
	ShieldBanIcon,
	ShieldCheckIcon,
	Trash2Icon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { MembershipStatusBadge } from "@/components/membership-status-badge";
import { SellerRoleBadge } from "@/components/seller-role-badge";
import { EmployeeStoresDialog } from "@/features/team/components/employee-stores-dialog";
import { StoreChips } from "@/features/team/components/store-chips";
import { useStores } from "@/hooks/use-stores";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/team/")({
	component: TeamPage,
	validateSearch: (search: Record<string, unknown>) => ({
		page: Number(search.page ?? 1),
		limit: Number(search.limit ?? 20),
	}),
});

// ─── Hooks ───────────────────────────────────────────────

function useEmployees(page: number, limit: number) {
	return useQuery({
		queryKey: ["employees", page, limit],
		queryFn: async () => {
			const response = await api().seller.employees.get({
				query: { page, limit },
			});
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento dipendenti",
				);
			}
			return response.data;
		},
	});
}

function useInvitations(enabled: boolean) {
	return useQuery({
		queryKey: ["employee-invitations"],
		queryFn: async () => {
			const response = await api().seller.employees.invitations.get();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento inviti",
				);
			}
			return response.data;
		},
		enabled,
	});
}

function useInviteEmployee() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (params: { email: string; storeIds: string[] }) => {
			const response = await api().seller.employees.invite.post(params);
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore durante l'invio dell'invito",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["employee-invitations"],
			});
		},
	});
}

function useCancelInvitation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (invitationId: string) => {
			const response = await api()
				.seller.employees.invitations({ invitationId })
				.delete();
			if (response.error) {
				throw new Error(
					response.error.value?.message ||
						"Errore durante l'annullamento dell'invito",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["employee-invitations"],
			});
		},
	});
}

function useBanEmployee() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (employeeId: string) => {
			const response = await api().seller.employees({ employeeId }).ban.patch();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore durante il ban",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["employees"] });
		},
	});
}

function useUnbanEmployee() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (employeeId: string) => {
			const response = await api()
				.seller.employees({ employeeId })
				.unban.patch();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore durante la riabilitazione",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["employees"] });
		},
	});
}

function useRemoveEmployee() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (employeeId: string) => {
			const response = await api().seller.employees({ employeeId }).delete();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore durante la rimozione",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["employees"] });
		},
	});
}

// ─── Status / role helpers ───────────────────────────────

// ─── Invite Employee Dialog (owner-only) ─────────────────

function InviteEmployeeDialog({ trigger }: { trigger?: React.ReactNode } = {}) {
	const inviteMutation = useInviteEmployee();
	const { data: allStores } = useStores();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [error, setError] = useState("");
	const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());

	function reset() {
		setEmail("");
		setError("");
		setSelectedStores(new Set());
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");

		if (!email.trim()) return;
		if (selectedStores.size === 0) return;

		try {
			await inviteMutation.mutateAsync({
				email: email.trim(),
				storeIds: Array.from(selectedStores),
			});
			reset();
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Errore durante l'invio");
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				setOpen(v);
				if (!v) reset();
			}}
		>
			<DialogTrigger asChild>
				{trigger ?? (
					<Button>
						<SendIcon />
						<span>Invita membro</span>
					</Button>
				)}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Invita un collaboratore</DialogTitle>
					<DialogDescription>
						Inserisci l&apos;email del collaboratore. Riceverà un link per
						creare la password e accedere al pannello seller.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					{error && (
						<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="invite-email">Email</Label>
						<Input
							id="invite-email"
							type="email"
							placeholder="collaboratore@esempio.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							disabled={inviteMutation.isPending}
							required
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label>Negozi a cui assegnare *</Label>
						<div className="flex max-h-48 flex-col gap-1 overflow-auto py-1">
							{(allStores ?? []).map((s) => {
								const isSelected = selectedStores.has(s.id);
								return (
									<button
										key={s.id}
										type="button"
										onClick={() =>
											setSelectedStores((prev) => {
												const next = new Set(prev);
												if (next.has(s.id)) next.delete(s.id);
												else next.add(s.id);
												return next;
											})
										}
										aria-pressed={isSelected}
										className={cn(
											"flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
											isSelected
												? "border-primary bg-primary/10 dark:bg-primary/15"
												: "border-transparent hover:bg-accent/50",
										)}
									>
										<span
											aria-hidden="true"
											className={cn(
												"flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
												isSelected
													? "border-primary bg-primary text-primary-foreground"
													: "border-border bg-card",
											)}
										>
											{isSelected && (
												<CheckIcon className="size-3.5" strokeWidth={3} />
											)}
										</span>
										<span className="truncate text-sm font-medium">
											{s.name}
										</span>
									</button>
								);
							})}
						</div>
						{selectedStores.size === 0 && (
							<p className="text-muted-foreground text-xs">
								Almeno 1 negozio richiesto
							</p>
						)}
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Annulla
							</Button>
						</DialogClose>
						<Button
							type="submit"
							disabled={
								inviteMutation.isPending ||
								!email.trim() ||
								selectedStores.size === 0
							}
						>
							{inviteMutation.isPending ? "Invio..." : "Invia invito"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// ─── Row Actions (owner-only) ────────────────────────────

function EmployeeActions({
	employeeId,
	employeeName,
	status,
}: {
	employeeId: string;
	employeeName: string;
	status: string;
}) {
	const banMutation = useBanEmployee();
	const unbanMutation = useUnbanEmployee();
	const removeMutation = useRemoveEmployee();
	const [confirmAction, setConfirmAction] = useState<
		"ban" | "unban" | "remove" | null
	>(null);
	const [storesDialogOpen, setStoresDialogOpen] = useState(false);

	const isPending =
		banMutation.isPending ||
		unbanMutation.isPending ||
		removeMutation.isPending;

	async function handleConfirm() {
		if (confirmAction === "ban") await banMutation.mutateAsync(employeeId);
		if (confirmAction === "unban") await unbanMutation.mutateAsync(employeeId);
		if (confirmAction === "remove")
			await removeMutation.mutateAsync(employeeId);
		setConfirmAction(null);
	}

	const confirmMessages: Record<
		string,
		{ title: string; description: string }
	> = {
		ban: {
			title: "Sospendere questo dipendente?",
			description:
				"Il dipendente non potrà più accedere al pannello seller fino alla riabilitazione.",
		},
		unban: {
			title: "Riabilitare questo dipendente?",
			description:
				"Il dipendente potrà nuovamente accedere al pannello seller.",
		},
		remove: {
			title: "Rimuovere questo dipendente?",
			description:
				"Il dipendente verrà rimosso dal team. Questa operazione non è reversibile.",
		},
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm">
						<MoreHorizontalIcon />
						<span className="sr-only">Azioni</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{status !== "removed" && (
						<DropdownMenuItem
							onSelect={(e) => {
								e.preventDefault();
								setStoresDialogOpen(true);
							}}
						>
							<PencilIcon />
							Modifica negozi
						</DropdownMenuItem>
					)}
					{status === "active" && (
						<DropdownMenuItem onClick={() => setConfirmAction("ban")}>
							<ShieldBanIcon />
							Sospendi
						</DropdownMenuItem>
					)}
					{status === "banned" && (
						<DropdownMenuItem onClick={() => setConfirmAction("unban")}>
							<ShieldCheckIcon />
							Riabilita
						</DropdownMenuItem>
					)}
					{status !== "removed" && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								onClick={() => setConfirmAction("remove")}
							>
								<Trash2Icon />
								Rimuovi
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<EmployeeStoresDialog
				employeeId={employeeId}
				employeeName={employeeName}
				open={storesDialogOpen}
				onOpenChange={setStoresDialogOpen}
			/>

			<AlertDialog
				open={confirmAction !== null}
				onOpenChange={(v) => !v && setConfirmAction(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmAction && confirmMessages[confirmAction].title}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmAction && confirmMessages[confirmAction].description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Annulla</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirm} disabled={isPending}>
							{isPending ? "Attendere..." : "Conferma"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// ─── Skeleton row ────────────────────────────────────────

function TeamTableSkeletonRow({ withActions }: { withActions: boolean }) {
	const cell = "bg-warm-edge";
	return (
		<TableRow className="hover:bg-transparent">
			<TableCell className="pl-6">
				<div className="flex items-center gap-3">
					<Skeleton className={`size-8 rounded-full ${cell}`} />
					<div className="flex flex-col gap-1.5">
						<Skeleton className={`h-3.5 w-32 ${cell}`} />
						<Skeleton className={`h-3 w-40 ${cell}`} />
					</div>
				</div>
			</TableCell>
			<TableCell>
				<Skeleton className={`h-5 w-20 rounded-full ${cell}`} />
			</TableCell>
			<TableCell>
				<Skeleton className={`h-5 w-20 rounded-full ${cell}`} />
			</TableCell>
			<TableCell>
				<Skeleton className={`h-4 w-24 ${cell}`} />
			</TableCell>
			<TableCell>
				<Skeleton className={`h-4 w-20 ${cell}`} />
			</TableCell>
			{withActions && (
				<TableCell className="pr-6 text-right">
					<Skeleton className={`ml-auto size-7 rounded-md ${cell}`} />
				</TableCell>
			)}
		</TableRow>
	);
}

// ─── Main Page ───────────────────────────────────────────

function TeamPage() {
	const { page, limit } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { data: session } = authClient.useSession();
	const { data, isLoading, error } = useEmployees(page, limit);

	const currentUserId = session?.user.id;
	const isOwner = session?.user.role === "seller";
	const colCount = isOwner ? 6 : 5;

	// Only fetch invitations for the owner
	const { data: invitationsData } = useInvitations(isOwner);
	const cancelMutation = useCancelInvitation();
	const pendingInvitations =
		invitationsData?.data?.filter((i) => i.status === "pending") ?? [];

	const totalPages = data?.pagination
		? Math.ceil(data.pagination.total / limit)
		: 0;

	const owner = data?.owner ?? null;
	const hasEmployees = (data?.data?.length ?? 0) > 0;
	const hasContent = !!owner || hasEmployees || pendingInvitations.length > 0;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Team</h1>
					<p className="text-muted-foreground text-sm">
						{isOwner
							? "Gestisci i membri del tuo team"
							: "Visualizza i membri del team"}
					</p>
				</div>
				{isOwner && <InviteEmployeeDialog />}
			</div>

			{error && (
				<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<div className="bg-card overflow-hidden rounded-lg border shadow-sm">
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/50 hover:bg-muted/50">
							<TableHead className="w-[30%] pl-6">Utente</TableHead>
							<TableHead className="w-[13%]">Ruolo</TableHead>
							<TableHead className="w-[13%]">Stato</TableHead>
							<TableHead className="w-[18%]">Negozi</TableHead>
							<TableHead className="w-[14%]">Data</TableHead>
							{isOwner && (
								<TableHead className="w-[12%] pr-6 text-right">
									Azioni
								</TableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: 5 }).map((_, i) => (
								<TeamTableSkeletonRow
									key={`skel-${i}`}
									withActions={!!isOwner}
								/>
							))
						) : (
							<>
								{/* Owner row — always first */}
								{owner && (
									<TableRow className="bg-saffron-deep/8 hover:bg-saffron-deep/8">
										<TableCell className="pl-6">
											<div className="flex items-center gap-3">
												<UserAvatar name={owner.name}>
													{currentUserId === owner.id && (
														<AvatarBadge
															className="bg-saffron-deep ring-card"
															aria-label="Sei tu"
															title="Sei tu"
														/>
													)}
												</UserAvatar>
												<div className="flex min-w-0 flex-col leading-tight">
													<span className="truncate font-semibold">
														{owner.name}
													</span>
													<span className="truncate text-muted-foreground text-xs">
														{owner.email}
													</span>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<SellerRoleBadge userRole="seller" />
										</TableCell>
										<TableCell>
											<MembershipStatusBadge status="active" />
										</TableCell>
										<TableCell className="text-muted-foreground text-sm italic">
											Tutti i negozi
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											—
										</TableCell>
										{isOwner && <TableCell />}
									</TableRow>
								)}

								{/* Employee rows */}
								{data?.data?.map((employee) => (
									<TableRow key={employee.id} className="group">
										<TableCell className="pl-6">
											<div className="flex items-center gap-3">
												<UserAvatar
													name={employee.user.name}
													image={employee.user.image}
												>
													{currentUserId === employee.userId && (
														<AvatarBadge
															className="bg-saffron-deep ring-card"
															aria-label="Sei tu"
															title="Sei tu"
														/>
													)}
												</UserAvatar>
												<div className="flex min-w-0 flex-col leading-tight">
													<span className="truncate font-semibold">
														{employee.user.name}
													</span>
													<span className="truncate text-muted-foreground text-xs">
														{employee.user.email}
													</span>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<SellerRoleBadge userRole="employee" />
										</TableCell>
										<TableCell>
											<MembershipStatusBadge status={employee.status} />
										</TableCell>
										<TableCell>
											<StoreChips storeIds={employee.storeIds} />
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{new Date(employee.createdAt).toLocaleDateString(
												"it-IT",
												{
													year: "numeric",
													month: "short",
													day: "numeric",
												},
											)}
										</TableCell>
										{isOwner && (
											<TableCell className="pr-6 text-right">
												<EmployeeActions
													employeeId={employee.id}
													employeeName={employee.user.name}
													status={employee.status}
												/>
											</TableCell>
										)}
									</TableRow>
								))}

								{/* Pending invitation rows — owner only, after employees */}
								{isOwner &&
									pendingInvitations.map((invitation) => (
										<TableRow
											key={`inv-${invitation.id}`}
											className="text-muted-foreground/80"
										>
											<TableCell className="pl-6 italic">
												<div className="flex items-center gap-3">
													<UserAvatar name={invitation.email.split("@")[0]} />
													<div className="flex min-w-0 flex-col leading-tight">
														<span className="truncate">
															{invitation.email.split("@")[0]}
														</span>
														<span className="truncate text-muted-foreground text-xs not-italic">
															{invitation.email}
														</span>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<SellerRoleBadge userRole="employee" />
											</TableCell>
											<TableCell>
												<MembershipStatusBadge status="pending" />
											</TableCell>
											<TableCell>
												<StoreChips storeIds={invitation.storeIds} />
											</TableCell>
											<TableCell className="text-sm">
												{new Date(invitation.createdAt).toLocaleDateString(
													"it-IT",
													{
														year: "numeric",
														month: "short",
														day: "numeric",
													},
												)}
											</TableCell>
											<TableCell className="pr-6 text-right">
												<Button
													variant="ghost"
													size="icon-sm"
													disabled={cancelMutation.isPending}
													onClick={() =>
														void cancelMutation.mutateAsync(invitation.id)
													}
													title="Annulla invito"
												>
													<XIcon />
													<span className="sr-only">Annulla invito</span>
												</Button>
											</TableCell>
										</TableRow>
									))}

								{/* Empty state */}
								{!hasContent && (
									<TableRow className="hover:bg-transparent">
										<TableCell colSpan={colCount} className="h-40 text-center">
											<div className="flex flex-col items-center gap-3">
												<UsersIcon className="text-muted-foreground/40 size-8" />
												<div>
													<p className="text-muted-foreground font-medium">
														Nessun membro nel team
													</p>
													<p className="text-muted-foreground/60 text-sm">
														Invita collaboratori per gestire insieme il tuo
														negozio
													</p>
												</div>
												{isOwner && (
													<InviteEmployeeDialog
														trigger={
															<Button size="sm" className="mt-1">
																<SendIcon />
																Invita il primo collaboratore
															</Button>
														}
													/>
												)}
											</div>
										</TableCell>
									</TableRow>
								)}
							</>
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-between">
					<DataPagination
						page={page}
						totalPages={totalPages}
						onPageChange={(p) => void navigate({ search: { page: p, limit } })}
					/>
					<div className="text-muted-foreground text-sm">
						Totale: {data?.pagination.total} dipendent
						{data?.pagination.total === 1 ? "e" : "i"}
					</div>
				</div>
			)}
		</div>
	);
}
