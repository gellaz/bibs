import { DataTable, SortableHeader } from "@bibs/ui/custom/data-table";
import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { SearchInput } from "@bibs/ui/custom/search-input";
import { StatusBadge } from "@bibs/ui/custom/status-badge";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { formatDate } from "@bibs/ui/lib/date";
import { displayName } from "@bibs/ui/lib/display-name";
import { parsePaginationSearch } from "@bibs/ui/lib/pagination-search";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { BanIcon } from "lucide-react";
import { useMemo } from "react";
import { UserRoleBadge } from "@/components/user-role-badge";
import { UserRowActions } from "@/components/user-row-actions";
import { authClient } from "@/lib/auth-client";
import {
	dataTableFooterLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

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
			...parsePaginationSearch(search),
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

function UsersPage() {
	"use no memo";

	const { page, limit, q: routeQ, sort, order } = Route.useSearch();
	const navigate = useNavigate({ from: "/users" });
	const offset = (page - 1) * limit;

	const { data: session } = authClient.useSession();
	const currentUserId = session?.user?.id;

	const effectiveQ = routeQ ?? "";

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
				throw new Error(result.error.message || m.users_load_error());
			}

			return result.data;
		},
	});

	const rows = useMemo<AdminUser[]>(
		() => (data?.users ?? []) as AdminUser[],
		[data],
	);

	const total = data?.total ?? 0;

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

	const columns = useMemo<DataTableColumnDef<AdminUser>[]>(
		() => [
			{
				id: "name",
				accessorKey: "name",
				enableHiding: false,
				enableSorting: true,
				meta: { menuLabel: m.common_name(), cellClassName: "font-semibold" },
				header: ({ column }) => (
					<SortableHeader column={column}>{m.common_name()}</SortableHeader>
				),
				cell: ({ row }) => (
					<span className="flex items-center gap-2">
						{displayName(row.original)}
						{row.original.banned ? (
							<StatusBadge tone="destructive" icon={BanIcon}>
								{m.users_banned()}
							</StatusBadge>
						) : null}
					</span>
				),
			},
			{
				id: "email",
				accessorKey: "email",
				enableSorting: true,
				meta: {
					menuLabel: m.common_email(),
					cellClassName: "text-muted-foreground text-sm",
				},
				header: ({ column }) => (
					<SortableHeader column={column}>{m.common_email()}</SortableHeader>
				),
				cell: ({ row }) => row.original.email,
			},
			{
				id: "role",
				header: m.users_column_role(),
				cell: ({ row }) => <UserRoleBadge role={row.original.role} />,
			},
			{
				id: "createdAt",
				accessorKey: "createdAt",
				enableSorting: true,
				meta: {
					menuLabel: m.common_registered_at(),
					cellClassName: "text-muted-foreground text-sm",
				},
				header: ({ column }) => (
					<SortableHeader column={column}>
						{m.common_registered_at()}
					</SortableHeader>
				),
				cell: ({ row }) => formatDate(row.original.createdAt, { long: true }),
			},
			{
				id: "actions",
				enableHiding: false,
				meta: {
					headerClassName: "w-12 text-right",
					cellClassName: "text-right",
				},
				header: ({ table }) => (
					<TableColumnsToggle
						table={table}
						labels={tableColumnsToggleLabels()}
						align="end"
					/>
				),
				cell: ({ row }) => (
					<UserRowActions
						userId={row.original.id}
						userName={displayName(row.original)}
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
				title={m.common_users()}
				description={m.users_description()}
			/>

			<SearchInput
				value={effectiveQ}
				onValueChange={(q) =>
					void navigate({
						search: (prev) => ({
							...prev,
							q: q.length > 0 ? q : undefined,
							page: 1,
						}),
					})
				}
				placeholder={m.users_search_placeholder()}
				aria-label={m.users_search_label()}
				clearLabel={m.common_clear_search()}
				className="max-w-md"
			/>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
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
				storageKey="admin.users.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				manualSorting={{ sorting, onSortingChange }}
				hideHeaderWhenEmpty={effectiveQ.length === 0}
				emptyState={
					effectiveQ.length > 0 ? (
						<EmptyState
							variant="no-results"
							title={m.common_no_results()}
							description={m.users_no_results_description({
								query: effectiveQ,
							})}
						/>
					) : (
						<EmptyState
							variant="empty"
							title={m.users_empty_title()}
							description={m.users_empty_description()}
						/>
					)
				}
			/>

			<DataTableFooter
				page={page}
				pageSize={limit}
				total={total}
				rangeLabel={(r) =>
					(r.total === 1
						? m.users_pagination_range_one
						: m.users_pagination_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) =>
					void navigate({
						search: (prev) => ({ ...prev, limit: size, page: 1 }),
					})
				}
				onPageChange={(next, options) =>
					void navigate({
						search: (prev) => ({ ...prev, page: next }),
						replace: options?.replace,
					})
				}
			/>
		</div>
	);
}
