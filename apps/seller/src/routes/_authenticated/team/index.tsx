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
import { Badge } from "@bibs/ui/components/badge";
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
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	MoreHorizontalIcon,
	SendIcon,
	ShieldBanIcon,
	ShieldCheckIcon,
	Trash2Icon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
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
		mutationFn: async (email: string) => {
			const response = await api().seller.employees.invite.post({ email });
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

const statusLabels: Record<string, string> = {
	active: "Attivo",
	banned: "Sospeso",
	removed: "Rimosso",
};

const statusVariants: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	active: "default",
	banned: "destructive",
	removed: "secondary",
};

// ─── Invite Employee Dialog (owner-only) ─────────────────

function InviteEmployeeDialog() {
	const inviteMutation = useInviteEmployee();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [error, setError] = useState("");

	function reset() {
		setEmail("");
		setError("");
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");

		if (!email.trim()) return;

		try {
			await inviteMutation.mutateAsync(email.trim());
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
				<Button>
					<SendIcon />
					<span>Invita membro</span>
				</Button>
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
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Annulla
							</Button>
						</DialogClose>
						<Button type="submit" disabled={inviteMutation.isPending}>
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
	status,
}: {
	employeeId: string;
	status: string;
}) {
	const banMutation = useBanEmployee();
	const unbanMutation = useUnbanEmployee();
	const removeMutation = useRemoveEmployee();
	const [confirmAction, setConfirmAction] = useState<
		"ban" | "unban" | "remove" | null
	>(null);

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

// ─── "Tu" badge ──────────────────────────────────────────

function YouBadge() {
	return (
		<Badge variant="outline" className="ml-1.5 text-xs">
			Tu
		</Badge>
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

			{isLoading ? (
				<div className="bg-card flex h-64 items-center justify-center rounded-lg border">
					<Spinner className="size-8" />
				</div>
			) : (
				<div className="bg-card overflow-hidden rounded-lg border shadow-sm">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/50 hover:bg-muted/50">
								<TableHead className="w-[25%] pl-6">Nome</TableHead>
								<TableHead className="w-[25%]">Email</TableHead>
								<TableHead className="w-[15%]">Ruolo</TableHead>
								<TableHead className="w-[15%]">Stato</TableHead>
								<TableHead className="w-[10%]">Data</TableHead>
								{isOwner && (
									<TableHead className="w-[10%] pr-6 text-right">
										Azioni
									</TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody>
							{/* Owner row — always first */}
							{owner && (
								<TableRow className="bg-muted/20">
									<TableCell className="pl-6 font-semibold">
										{owner.name}
										{currentUserId === owner.id && <YouBadge />}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{owner.email}
									</TableCell>
									<TableCell>
										<Badge variant="default">Titolare</Badge>
									</TableCell>
									<TableCell>
										<Badge variant="default">Attivo</Badge>
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
									<TableCell className="pl-6 font-semibold">
										{employee.user.name}
										{currentUserId === employee.userId && <YouBadge />}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{employee.user.email}
									</TableCell>
									<TableCell>
										<Badge variant="secondary">Dipendente</Badge>
									</TableCell>
									<TableCell>
										<Badge
											variant={statusVariants[employee.status] ?? "outline"}
										>
											{statusLabels[employee.status] ?? employee.status}
										</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{new Date(employee.createdAt).toLocaleDateString("it-IT", {
											year: "numeric",
											month: "short",
											day: "numeric",
										})}
									</TableCell>
									{isOwner && (
										<TableCell className="pr-6 text-right">
											<EmployeeActions
												employeeId={employee.id}
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
											{invitation.email.split("@")[0]}
										</TableCell>
										<TableCell className="text-sm">
											{invitation.email}
										</TableCell>
										<TableCell>
											<Badge variant="secondary">Dipendente</Badge>
										</TableCell>
										<TableCell>
											<Badge variant="outline">In attesa</Badge>
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
									<TableCell colSpan={colCount} className="h-32 text-center">
										<div className="flex flex-col items-center gap-2">
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
										</div>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			)}

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
