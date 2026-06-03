import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	type AlertDialogMediaVariant,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { AvatarBadge } from "@bibs/ui/components/avatar";
import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable } from "@bibs/ui/components/data-table";
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
import { EmptyState } from "@bibs/ui/components/empty-state";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { UserAvatar } from "@bibs/ui/components/user-avatar";
import { cn } from "@bibs/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	CheckIcon,
	MoreHorizontalIcon,
	PencilIcon,
	SendIcon,
	ShieldBanIcon,
	ShieldCheckIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
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
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: "Errore durante l'annullamento dell'invito",
			);
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
						<div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
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
											"focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2",
											isSelected
												? "border-primary bg-primary/10 dark:bg-primary/15"
												: "hover:bg-accent/50 border-transparent",
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
		try {
			if (confirmAction === "ban") await banMutation.mutateAsync(employeeId);
			if (confirmAction === "unban")
				await unbanMutation.mutateAsync(employeeId);
			if (confirmAction === "remove")
				await removeMutation.mutateAsync(employeeId);
		} catch (err) {
			// Surface the failure instead of an unhandled rejection, and ensure the
			// dialog still closes (finally) rather than getting stuck open.
			toast.error(
				err instanceof Error ? err.message : "Operazione non riuscita",
			);
		} finally {
			setConfirmAction(null);
		}
	}

	const confirmMessages: Record<
		string,
		{
			title: string;
			description: string;
			variant: AlertDialogMediaVariant;
		}
	> = {
		ban: {
			title: "Sospendere questo dipendente?",
			description:
				"Il dipendente non potrà più accedere al pannello seller fino alla riabilitazione.",
			variant: "warning",
		},
		unban: {
			title: "Riabilitare questo dipendente?",
			description:
				"Il dipendente potrà nuovamente accedere al pannello seller.",
			variant: "info",
		},
		remove: {
			title: "Rimuovere questo dipendente?",
			description:
				"Il dipendente verrà rimosso dal team. Questa operazione non è reversibile.",
			variant: "destructive",
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
						{confirmAction && (
							<AlertDialogMedia
								variant={confirmMessages[confirmAction].variant}
							/>
						)}
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

// ─── Row model ───────────────────────────────────────────

type OwnerRow = {
	kind: "owner";
	id: string;
	owner: { id: string; name: string; email: string };
	isSelf: boolean;
};
type EmployeeRow = {
	kind: "employee";
	id: string;
	employee: NonNullable<
		Awaited<
			ReturnType<ReturnType<typeof api>["seller"]["employees"]["get"]>
		>["data"]
	>["data"][number];
	isSelf: boolean;
};
type InvitationRow = {
	kind: "invitation";
	id: string;
	invitation: NonNullable<
		Awaited<
			ReturnType<
				ReturnType<typeof api>["seller"]["employees"]["invitations"]["get"]
			>
		>["data"]
	>["data"][number];
};
type TeamRow = OwnerRow | EmployeeRow | InvitationRow;

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "short",
	day: "numeric",
};

// ─── Main Page ───────────────────────────────────────────

function TeamPage() {
	"use no memo";

	const { page, limit } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { data: session } = authClient.useSession();
	const { data, isLoading, error } = useEmployees(page, limit);

	const currentUserId = session?.user.id;
	const isOwner = session?.user.role === "seller";

	const { data: invitationsData } = useInvitations(isOwner);
	const cancelMutation = useCancelInvitation();
	const pendingInvitations = useMemo(
		() => invitationsData?.data?.filter((i) => i.status === "pending") ?? [],
		[invitationsData],
	);

	const totalPages = data?.pagination
		? Math.ceil(data.pagination.total / limit)
		: 0;

	const owner = data?.owner ?? null;

	const rows = useMemo<TeamRow[]>(() => {
		const out: TeamRow[] = [];
		// The owner row and pending invitations are not part of the server-paginated
		// employee list (pagination.total counts employees only). Inject them on the
		// first page only — otherwise they re-appear on every page and the visible
		// row count can exceed `limit`.
		if (page === 1 && owner) {
			out.push({
				kind: "owner",
				id: `owner-${owner.id}`,
				owner,
				isSelf: currentUserId === owner.id,
			});
		}
		for (const e of data?.data ?? []) {
			out.push({
				kind: "employee",
				id: `emp-${e.id}`,
				employee: e,
				isSelf: currentUserId === e.userId,
			});
		}
		if (page === 1 && isOwner) {
			for (const inv of pendingInvitations) {
				out.push({
					kind: "invitation",
					id: `inv-${inv.id}`,
					invitation: inv,
				});
			}
		}
		return out;
	}, [page, owner, data?.data, currentUserId, isOwner, pendingInvitations]);

	const columns = useMemo<ColumnDef<TeamRow>[]>(() => {
		const cols: ColumnDef<TeamRow>[] = [
			{
				id: "user",
				header: "Utente",
				enableHiding: false,
				meta: {
					headerClassName: "w-[30%] pl-6",
					cellClassName: "pl-6",
				},
				cell: ({ row }) => {
					const r = row.original;
					if (r.kind === "owner") {
						return (
							<div className="flex items-center gap-3">
								<UserAvatar name={r.owner.name}>
									{r.isSelf && (
										<AvatarBadge
											className="bg-saffron-deep ring-card"
											aria-label="Sei tu"
											title="Sei tu"
										/>
									)}
								</UserAvatar>
								<div className="flex min-w-0 flex-col leading-tight">
									<span className="truncate font-semibold">{r.owner.name}</span>
									<span className="text-muted-foreground truncate text-xs">
										{r.owner.email}
									</span>
								</div>
							</div>
						);
					}
					if (r.kind === "employee") {
						return (
							<div className="flex items-center gap-3">
								<UserAvatar
									name={r.employee.user.name}
									image={r.employee.user.image}
								>
									{r.isSelf && (
										<AvatarBadge
											className="bg-saffron-deep ring-card"
											aria-label="Sei tu"
											title="Sei tu"
										/>
									)}
								</UserAvatar>
								<div className="flex min-w-0 flex-col leading-tight">
									<span className="truncate font-semibold">
										{r.employee.user.name}
									</span>
									<span className="text-muted-foreground truncate text-xs">
										{r.employee.user.email}
									</span>
								</div>
							</div>
						);
					}
					return (
						<div className="flex items-center gap-3 italic">
							<UserAvatar name={r.invitation.email.split("@")[0]} />
							<div className="flex min-w-0 flex-col leading-tight">
								<span className="truncate">
									{r.invitation.email.split("@")[0]}
								</span>
								<span className="text-muted-foreground truncate text-xs not-italic">
									{r.invitation.email}
								</span>
							</div>
						</div>
					);
				},
			},
			{
				id: "role",
				header: "Ruolo",
				meta: { headerClassName: "w-[13%]" },
				cell: ({ row }) => {
					const r = row.original;
					return (
						<SellerRoleBadge
							userRole={r.kind === "owner" ? "seller" : "employee"}
						/>
					);
				},
			},
			{
				id: "status",
				header: "Stato",
				meta: { headerClassName: "w-[13%]" },
				cell: ({ row }) => {
					const r = row.original;
					if (r.kind === "owner")
						return <MembershipStatusBadge status="active" />;
					if (r.kind === "employee")
						return <MembershipStatusBadge status={r.employee.status} />;
					return <MembershipStatusBadge status="pending" />;
				},
			},
			{
				id: "stores",
				header: "Negozi",
				meta: { headerClassName: "w-[18%]" },
				cell: ({ row }) => {
					const r = row.original;
					if (r.kind === "owner") {
						return (
							<span className="text-muted-foreground text-sm italic">
								Tutti i negozi
							</span>
						);
					}
					const storeIds =
						r.kind === "employee" ? r.employee.storeIds : r.invitation.storeIds;
					return <StoreChips storeIds={storeIds} />;
				},
			},
			{
				id: "createdAt",
				header: "Data",
				meta: {
					headerClassName: "w-[14%]",
					cellClassName: "text-muted-foreground text-sm",
				},
				cell: ({ row }) => {
					const r = row.original;
					if (r.kind === "owner") return "—";
					const createdAt =
						r.kind === "employee"
							? r.employee.createdAt
							: r.invitation.createdAt;
					return new Date(createdAt).toLocaleDateString("it-IT", DATE_FMT_OPTS);
				},
			},
		];

		// The actions column always exists so the toggle button has a home.
		// For non-owner viewers the cells render nothing (read-only view).
		cols.push({
			id: "actions",
			enableHiding: false,
			meta: {
				headerClassName: "w-[12%] pr-6 text-right",
				cellClassName: "pr-6 text-right",
			},
			header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
			cell: ({ row }) => {
				if (!isOwner) return null;
				const r = row.original;
				if (r.kind === "owner") return null;
				if (r.kind === "employee") {
					return (
						<EmployeeActions
							employeeId={r.employee.id}
							employeeName={r.employee.user.name}
							status={r.employee.status}
						/>
					);
				}
				return (
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={cancelMutation.isPending}
						onClick={() => cancelMutation.mutate(r.invitation.id)}
						title="Annulla invito"
					>
						<XIcon />
						<span className="sr-only">Annulla invito</span>
					</Button>
				);
			},
		});

		return cols;
	}, [isOwner, cancelMutation]);

	return (
		<div className="flex h-full min-w-0 flex-col gap-6">
			<div className="flex shrink-0 items-center justify-between">
				<div>
					<h1 className="font-display text-2xl font-semibold tracking-tight">
						Team
					</h1>
					<p className="text-muted-foreground text-sm">
						{isOwner
							? "Gestisci i membri del tuo team"
							: "Visualizza i membri del team"}
					</p>
				</div>
				{isOwner && <InviteEmployeeDialog />}
			</div>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 shrink-0 rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="seller.team.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				containerClassName="flex-1 min-h-0 min-w-0 overflow-auto"
				rowClassName={(row) => {
					const r = row.original;
					if (r.kind === "owner")
						return "bg-saffron-deep/8 hover:bg-saffron-deep/8";
					if (r.kind === "invitation") return "text-muted-foreground/80";
					return "";
				}}
				hideHeaderWhenEmpty
				emptyState={
					<EmptyState
						title="Nessun membro nel team"
						description="Invita collaboratori per gestire insieme il tuo negozio."
						action={
							isOwner ? (
								<InviteEmployeeDialog
									trigger={
										<Button>
											<SendIcon />
											Invita il primo collaboratore
										</Button>
									}
								/>
							) : undefined
						}
					/>
				}
			/>

			{totalPages > 1 && (
				<div className="flex shrink-0 items-center justify-between">
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
