import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable } from "@bibs/ui/components/data-table";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { UsersIcon } from "lucide-react";
import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { UserRoleBadge } from "@/components/user-role-badge";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/users")({
	component: UsersPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
		};
	},
});

type AdminUser = {
	id: string;
	name: string;
	email: string;
	role: string | null | undefined;
	createdAt: string | Date;
};

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
};

function UsersPage() {
	"use no memo";

	const { page, limit } = Route.useSearch();
	const navigate = useNavigate({ from: "/users" });
	const offset = (page - 1) * limit;

	const { data, isLoading, error } = useQuery({
		queryKey: ["users", page, limit],
		queryFn: async () => {
			const result = await authClient.admin.listUsers({
				query: {
					limit,
					offset,
					sortBy: "createdAt",
					sortDirection: "desc",
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

	const columns = useMemo<ColumnDef<AdminUser>[]>(
		() => [
			{
				id: "name",
				header: "Nome",
				enableHiding: false,
				meta: {
					headerClassName: "pl-6",
					cellClassName: "pl-6 font-semibold",
				},
				cell: ({ row }) => row.original.name,
			},
			{
				id: "email",
				header: "Email",
				meta: { cellClassName: "text-muted-foreground text-sm" },
				cell: ({ row }) => row.original.email,
			},
			{
				id: "role",
				header: "Ruolo",
				cell: ({ row }) => <UserRoleBadge role={row.original.role} />,
			},
			{
				id: "createdAt",
				header: "Registrato il",
				meta: {
					headerClassName: "pr-2",
					cellClassName: "text-muted-foreground text-sm",
				},
				cell: ({ row }) =>
					new Date(row.original.createdAt).toLocaleDateString(
						"it-IT",
						DATE_FMT_OPTS,
					),
			},
			{
				id: "toggle",
				enableHiding: false,
				meta: { headerClassName: "w-12 pr-6 text-right" },
				header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
				cell: () => null,
			},
		],
		[],
	);

	return (
		<div className="space-y-4">
			<PageHeader
				title="Utenti"
				description="Gestisci gli utenti registrati sulla piattaforma"
			/>

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
				emptyState={
					<div className="flex flex-col items-center gap-2">
						<UsersIcon className="text-muted-foreground/40 size-8" />
						<p className="text-muted-foreground font-medium">
							Nessun utente trovato
						</p>
					</div>
				}
			/>

			{total > 0 && (
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
					<p className="text-muted-foreground text-sm tabular-nums">
						{(page - 1) * limit + 1}–{Math.min(page * limit, total)} di {total}{" "}
						utent{total === 1 ? "e" : "i"}
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
