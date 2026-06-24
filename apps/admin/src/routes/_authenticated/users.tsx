import { Badge } from "@bibs/ui/components/badge";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable, SortableHeader } from "@bibs/ui/components/data-table";
import { EmptyState } from "@bibs/ui/components/empty-state";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@bibs/ui/components/input-group";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { UserRoleBadge } from "@/components/user-role-badge";
import { UserRowActions } from "@/components/user-row-actions";
import { authClient } from "@/lib/auth-client";

type UserSortField = "name" | "email" | "createdAt";
type SortDir = "asc" | "desc";

const SORT_FIELDS: UserSortField[] = ["name", "email", "createdAt"];

export const Route = createFileRoute("/_authenticated/users")({
	component: UsersPage,
	validateSearch: (
		search: Record<string, unknown>,
	): {
		page: number;
		limit: number;
		q?: string;
		sort?: UserSortField;
		order?: SortDir;
	} => {
		const rawQ = typeof search.q === "string" ? search.q : "";
		const sort = SORT_FIELDS.includes(search.sort as UserSortField)
			? (search.sort as UserSortField)
			: undefined;
		const order =
			search.order === "asc" || search.order === "desc"
				? (search.order as SortDir)
				: undefined;
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			...(rawQ.length > 0 ? { q: rawQ } : {}),
			...(sort && order ? { sort, order } : {}),
		};
	},
});

type AdminUser = {
	id: string;
	name: string;
	email: string;
	role: string | null | undefined;
	banned: boolean | null | undefined;
	createdAt: string | Date;
};

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
};

function UsersPage() {
	"use no memo";

	const { page, limit, q: routeQ, sort, order } = Route.useSearch();
	const navigate = useNavigate({ from: "/users" });
	const offset = (page - 1) * limit;

	const { data: session } = authClient.useSession();
	const currentUserId = session?.user?.id;

	// Input controllato; il valore deboundato finisce nell'URL e scatena la
	// query. Su back/forward il localQ viene riallineato a routeQ.
	const [localQ, setLocalQ] = useState(routeQ ?? "");
	const debouncedQ = useDebouncedValue(localQ, 300);
	const effectiveQ = routeQ ?? "";

	useEffect(() => {
		setLocalQ(routeQ ?? "");
	}, [routeQ]);

	useEffect(() => {
		if (debouncedQ === effectiveQ) return;
		void navigate({
			search: (prev) => ({
				...prev,
				q: debouncedQ.length > 0 ? debouncedQ : undefined,
				page: 1,
			}),
		});
	}, [debouncedQ, effectiveQ, navigate]);

	const { data, isLoading, error } = useQuery({
		queryKey: ["users", page, limit, effectiveQ, sort, order],
		queryFn: async () => {
			const result = await authClient.admin.listUsers({
				query: {
					limit,
					offset,
					sortBy: sort ?? "createdAt",
					sortDirection: order ?? "desc",
					...(effectiveQ.length > 0
						? {
								// better-auth cerca su un solo campo: indoviniamo quello giusto
								// dalla presenza della "@" così un'unica casella copre nome ed
								// email senza una seconda query.
								searchField: effectiveQ.includes("@") ? "email" : "name",
								searchOperator: "contains",
								searchValue: effectiveQ,
							}
						: {}),
				},
			});

			if (result.error) {
				throw new Error(
					result.error.message || "Errore nel caricamento utenti",
				);
			}

			return result.data;
		},
	});

	const rows = useMemo<AdminUser[]>(
		() => (data?.users ?? []) as AdminUser[],
		[data],
	);

	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / limit);

	const sorting: SortingState = sort
		? [{ id: sort, desc: order === "desc" }]
		: [];

	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		void navigate({
			search: (prev) => ({
				...prev,
				sort: head ? (head.id as UserSortField) : undefined,
				order: head ? (head.desc ? "desc" : "asc") : undefined,
				page: 1,
			}),
		});
	};

	const columns = useMemo<ColumnDef<AdminUser>[]>(
		() => [
			{
				id: "name",
				accessorKey: "name",
				enableHiding: false,
				enableSorting: true,
				meta: {
					menuLabel: "Nome",
					headerClassName: "pl-6",
					cellClassName: "pl-6 font-semibold",
				},
				header: ({ column }) => (
					<SortableHeader column={column}>Nome</SortableHeader>
				),
				cell: ({ row }) => (
					<span className="flex items-center gap-2">
						{row.original.name}
						{row.original.banned ? (
							<Badge variant="destructive">Bannato</Badge>
						) : null}
					</span>
				),
			},
			{
				id: "email",
				accessorKey: "email",
				enableSorting: true,
				meta: {
					menuLabel: "Email",
					cellClassName: "text-muted-foreground text-sm",
				},
				header: ({ column }) => (
					<SortableHeader column={column}>Email</SortableHeader>
				),
				cell: ({ row }) => row.original.email,
			},
			{
				id: "role",
				header: "Ruolo",
				cell: ({ row }) => <UserRoleBadge role={row.original.role} />,
			},
			{
				id: "createdAt",
				accessorKey: "createdAt",
				enableSorting: true,
				meta: {
					menuLabel: "Registrato il",
					cellClassName: "text-muted-foreground text-sm",
				},
				header: ({ column }) => (
					<SortableHeader column={column}>Registrato il</SortableHeader>
				),
				cell: ({ row }) =>
					new Date(row.original.createdAt).toLocaleDateString(
						"it-IT",
						DATE_FMT_OPTS,
					),
			},
			{
				id: "actions",
				enableHiding: false,
				meta: {
					headerClassName: "w-12 pr-6 text-right",
					cellClassName: "pr-6 text-right",
				},
				header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
				cell: ({ row }) => (
					<UserRowActions
						userId={row.original.id}
						userName={row.original.name}
						banned={Boolean(row.original.banned)}
						canBan={row.original.id !== currentUserId}
					/>
				),
			},
		],
		[currentUserId],
	);

	return (
		<div className="space-y-4">
			<PageHeader
				title="Utenti"
				description="Gestisci gli utenti registrati sulla piattaforma"
			/>

			<InputGroup className="max-w-md">
				<InputGroupAddon align="inline-start">
					<SearchIcon />
				</InputGroupAddon>
				<InputGroupInput
					value={localQ}
					onChange={(e) => setLocalQ(e.target.value)}
					placeholder="Cerca per nome o email..."
					aria-label="Cerca utenti"
				/>
				{localQ.length > 0 && (
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							size="icon-xs"
							onClick={() => setLocalQ("")}
							aria-label="Cancella ricerca"
						>
							<XIcon />
						</InputGroupButton>
					</InputGroupAddon>
				)}
			</InputGroup>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.users.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				manualSorting={{ sorting, onSortingChange }}
				hideHeaderWhenEmpty={effectiveQ.length === 0}
				emptyState={
					effectiveQ.length > 0 ? (
						<EmptyState
							variant="no-results"
							title="Nessun risultato"
							description={`Nessun utente corrisponde a "${effectiveQ}".`}
						/>
					) : (
						<EmptyState
							variant="empty"
							title="Nessun utente"
							description="Gli utenti registrati sulla piattaforma appariranno qui."
						/>
					)
				}
			/>

			{total > 0 && (
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
					<p className="text-muted-foreground text-sm tabular-nums">
						{offset + 1}–{Math.min(page * limit, total)} di {total} utent
						{total === 1 ? "e" : "i"}
					</p>
					<div className="flex items-center gap-4">
						<PageSizeSelector
							pageSize={limit}
							onPageSizeChange={(size) =>
								void navigate({
									search: (prev) => ({ ...prev, limit: size, page: 1 }),
								})
							}
						/>
						<DataPagination
							page={page}
							totalPages={totalPages}
							onPageChange={(next) =>
								void navigate({
									search: (prev) => ({ ...prev, page: next }),
								})
							}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
