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
import { toast } from "@bibs/ui/components/sonner";
import { DataTable } from "@bibs/ui/custom/data-table";
import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { UserAvatar } from "@bibs/ui/custom/user-avatar";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { formatDate } from "@bibs/ui/lib/date";
import { displayName } from "@bibs/ui/lib/display-name";
import { parsePaginationSearch } from "@bibs/ui/lib/pagination-search";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { cn } from "@bibs/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CheckIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RotateCwIcon,
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
import { sellerApi } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
	dataTableFooterLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/team/")({
	component: TeamPage,
	validateSearch: (search: Record<string, unknown>) => ({
		...parsePaginationSearch(search),
	}),
});

// ─── Hooks ───────────────────────────────────────────────

function useEmployees(page: number, limit: number) {
	return useQuery({
		queryKey: ["employees", page, limit],
		queryFn: async () => {
			const response = await sellerApi.employees.$get({
				query: { page, limit },
			});
			return unwrapJson(response, m.team_load_error());
		},
	});
}

function useInvitations(enabled: boolean) {
	return useQuery({
		queryKey: ["employee-invitations"],
		queryFn: async () => {
			const response = await sellerApi.employees.invitations.$get();
			return unwrapJson(response, m.team_invitations_load_error());
		},
		enabled,
	});
}

function useInviteEmployee() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (params: { email: string; storeIds: string[] }) => {
			const response = await sellerApi.employees.invite.$post({
				json: params,
			});
			return unwrapJson(response, m.team_invite_error());
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["employee-invitations"],
			});
		},
	});
}

function useResendInvitation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (invitationId: string) => {
			const response = await sellerApi.employees.invitations[
				":invitationId"
			].resend.$post({ param: { invitationId } });
			return unwrapJson(response, m.team_resend_error());
		},
		onSuccess: ({ data: invitation }) => {
			toast.success(m.team_resent({ email: invitation.email }));
			void queryClient.invalidateQueries({
				queryKey: ["employee-invitations"],
			});
		},
		onError: (err) => {
			toast.error(err instanceof Error ? err.message : m.team_resend_error());
		},
	});
}

function useCancelInvitation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (invitationId: string) => {
			const response = await sellerApi.employees.invitations[
				":invitationId"
			].$delete({ param: { invitationId } });
			return unwrapJson(response, m.team_cancel_invite_error());
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["employee-invitations"],
			});
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : m.team_cancel_invite_error(),
			);
		},
	});
}

function useBanEmployee() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (employeeId: string) => {
			const response = await sellerApi.employees[":employeeId"].ban.$patch({
				param: { employeeId },
			});
			return unwrapJson(response, m.team_ban_error());
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
			const response = await sellerApi.employees[":employeeId"].unban.$patch({
				param: { employeeId },
			});
			return unwrapJson(response, m.team_unban_error());
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
			const response = await sellerApi.employees[":employeeId"].$delete({
				param: { employeeId },
			});
			return unwrapJson(response, m.team_remove_error());
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["employees"] });
		},
	});
}

// ─── Invite Employee Dialog (owner-only) ─────────────────

function InviteEmployeeDialog({
	trigger,
}: {
	trigger?: React.ReactElement;
} = {}) {
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
			setError(err instanceof Error ? err.message : m.team_invite_send_error());
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
			<DialogTrigger
				render={
					trigger ?? (
						<Button>
							<SendIcon />
							<span>{m.team_invite_trigger()}</span>
						</Button>
					)
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.team_invite_title()}</DialogTitle>
					<DialogDescription>{m.team_invite_description()}</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					{error && (
						<div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
							{error}
						</div>
					)}
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="invite-email">{m.team_invite_email()}</Label>
						<Input
							id="invite-email"
							type="email"
							placeholder={m.team_invite_email_placeholder()}
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							disabled={inviteMutation.isPending}
							required
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label>{m.team_invite_stores()}</Label>
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
											"focus-visible:focus-ring flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors",
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
								{m.team_invite_stores_required()}
							</p>
						)}
					</div>
					<DialogFooter>
						<DialogClose render={<Button type="button" variant="outline" />}>
							{m.common_cancel()}
						</DialogClose>
						<Button
							type="submit"
							disabled={
								inviteMutation.isPending ||
								!email.trim() ||
								selectedStores.size === 0
							}
						>
							{inviteMutation.isPending
								? m.team_invite_sending()
								: m.team_invite_submit()}
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
			toast.error(err instanceof Error ? err.message : m.team_action_failed());
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
			title: m.team_confirm_ban_title(),
			description: m.team_confirm_ban_description(),
			variant: "warning",
		},
		unban: {
			title: m.team_confirm_unban_title(),
			description: m.team_confirm_unban_description(),
			variant: "info",
		},
		remove: {
			title: m.team_confirm_remove_title(),
			description: m.team_confirm_remove_description(),
			variant: "destructive",
		},
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
					<MoreHorizontalIcon />
					<span className="sr-only">{m.common_actions()}</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{status !== "removed" && (
						<DropdownMenuItem onClick={() => setStoresDialogOpen(true)}>
							<PencilIcon />
							{m.team_edit_stores()}
						</DropdownMenuItem>
					)}
					{status === "active" && (
						<DropdownMenuItem onClick={() => setConfirmAction("ban")}>
							<ShieldBanIcon />
							{m.team_ban()}
						</DropdownMenuItem>
					)}
					{status === "banned" && (
						<DropdownMenuItem onClick={() => setConfirmAction("unban")}>
							<ShieldCheckIcon />
							{m.team_unban()}
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
								{m.team_remove()}
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
						<AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirm} disabled={isPending}>
							{isPending ? m.team_confirm_pending() : m.common_confirm()}
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
		ReturnType<typeof useEmployees>["data"]
	>["data"][number];
	isSelf: boolean;
};
type InvitationRow = {
	kind: "invitation";
	id: string;
	invitation: NonNullable<
		ReturnType<typeof useInvitations>["data"]
	>["data"][number];
};
type TeamRow = OwnerRow | EmployeeRow | InvitationRow;

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
	const resendMutation = useResendInvitation();
	const pendingInvitations = useMemo(
		() => invitationsData?.data?.filter((i) => i.status === "pending") ?? [],
		[invitationsData],
	);

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

	const columns = useMemo<DataTableColumnDef<TeamRow>[]>(() => {
		const cols: DataTableColumnDef<TeamRow>[] = [
			{
				id: "user",
				header: m.team_col_user(),
				enableHiding: false,
				meta: {
					headerClassName: "w-[30%]",
				},
				cell: ({ row }) => {
					const r = row.original;
					if (r.kind === "owner") {
						return (
							<div className="flex items-center gap-3">
								<UserAvatar name={displayName(r.owner)}>
									{r.isSelf && (
										<AvatarBadge
											className="bg-saffron-deep ring-card"
											aria-label={m.team_you()}
											title={m.team_you()}
										/>
									)}
								</UserAvatar>
								<div className="flex min-w-0 flex-col leading-tight">
									<span className="truncate font-semibold">
										{displayName(r.owner)}
									</span>
									{displayName(r.owner) !== r.owner.email && (
										<span className="text-muted-foreground truncate text-xs">
											{r.owner.email}
										</span>
									)}
								</div>
							</div>
						);
					}
					if (r.kind === "employee") {
						return (
							<div className="flex items-center gap-3">
								<UserAvatar
									name={displayName(r.employee.user)}
									image={r.employee.user.image}
								>
									{r.isSelf && (
										<AvatarBadge
											className="bg-saffron-deep ring-card"
											aria-label={m.team_you()}
											title={m.team_you()}
										/>
									)}
								</UserAvatar>
								<div className="flex min-w-0 flex-col leading-tight">
									<span className="truncate font-semibold">
										{displayName(r.employee.user)}
									</span>
									{displayName(r.employee.user) !== r.employee.user.email && (
										<span className="text-muted-foreground truncate text-xs">
											{r.employee.user.email}
										</span>
									)}
								</div>
							</div>
						);
					}
					return (
						<div className="flex items-center gap-3 italic">
							<UserAvatar name={r.invitation.email} />
							<span className="min-w-0 truncate leading-tight">
								{r.invitation.email}
							</span>
						</div>
					);
				},
			},
			{
				id: "role",
				header: m.team_col_role(),
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
				header: m.common_status(),
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
				header: m.team_col_stores(),
				meta: { headerClassName: "w-[18%]" },
				cell: ({ row }) => {
					const r = row.original;
					if (r.kind === "owner") {
						return (
							<span className="text-muted-foreground text-sm italic">
								{m.team_all_stores()}
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
				header: m.common_date(),
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
					return formatDate(createdAt);
				},
			},
		];

		// The actions column always exists so the toggle button has a home.
		// For non-owner viewers the cells render nothing (read-only view).
		cols.push({
			id: "actions",
			enableHiding: false,
			meta: {
				headerClassName: "w-[12%] text-right",
				cellClassName: "text-right",
			},
			header: ({ table }) => (
				<TableColumnsToggle
					table={table}
					labels={tableColumnsToggleLabels()}
					align="end"
				/>
			),
			cell: ({ row }) => {
				if (!isOwner) return null;
				const r = row.original;
				if (r.kind === "owner") return null;
				if (r.kind === "employee") {
					return (
						<EmployeeActions
							employeeId={r.employee.id}
							employeeName={displayName(r.employee.user)}
							status={r.employee.status}
						/>
					);
				}
				return (
					<div className="inline-flex gap-1">
						<Button
							variant="ghost"
							size="icon-sm"
							disabled={resendMutation.isPending}
							onClick={() => resendMutation.mutate(r.invitation.id)}
							title={m.team_resend()}
						>
							<RotateCwIcon />
							<span className="sr-only">{m.team_resend()}</span>
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							disabled={cancelMutation.isPending}
							onClick={() => cancelMutation.mutate(r.invitation.id)}
							title={m.team_cancel_invite()}
						>
							<XIcon />
							<span className="sr-only">{m.team_cancel_invite()}</span>
						</Button>
					</div>
				);
			},
		});

		return cols;
	}, [isOwner, cancelMutation, resendMutation]);

	return (
		<div className="flex h-full min-w-0 flex-col gap-6">
			<PageHeader
				title={m.team_title()}
				description={isOwner ? m.team_subtitle() : m.team_subtitle_readonly()}
			>
				{isOwner && <InviteEmployeeDialog />}
			</PageHeader>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 shrink-0 rounded-lg border p-4">
					<p className="text-sm">
						{m.common_load_error_with_message({
							message: (error as Error).message,
						})}
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
						title={m.team_empty_title()}
						description={m.team_empty_description()}
						action={
							isOwner ? (
								<InviteEmployeeDialog
									trigger={
										<Button>
											<SendIcon />
											{m.team_empty_action()}
										</Button>
									}
								/>
							) : undefined
						}
					/>
				}
			/>

			{/* Range e totale contano solo i dipendenti: titolare e inviti stanno
			    fuori dalla paginazione. */}
			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) =>
					(r.total === 1
						? m.team_pagination_range_one
						: m.team_pagination_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) =>
					void navigate({ search: { page: 1, limit: size } })
				}
				onPageChange={(next, options) =>
					void navigate({
						search: { page: next, limit },
						replace: options?.replace,
					})
				}
			/>
		</div>
	);
}
