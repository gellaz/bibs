import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
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

function UsersPage() {
	const { page, limit } = Route.useSearch();
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

	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / limit);

	return (
		<div className="space-y-4">
			<PageHeader
				title="Utenti"
				description="Gestisci gli utenti registrati sulla piattaforma"
			/>

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
								<TableHead className="pl-6">Nome</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Ruolo</TableHead>
								<TableHead className="pr-6">Registrato il</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.users && data.users.length > 0 ? (
								data.users.map((user) => (
									<TableRow key={user.id} className="group">
										<TableCell className="pl-6 font-semibold">
											{user.name}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{user.email}
										</TableCell>
										<TableCell>
											<UserRoleBadge role={user.role} />
										</TableCell>
										<TableCell className="text-muted-foreground pr-6 text-sm">
											{new Date(user.createdAt).toLocaleDateString("it-IT", {
												year: "numeric",
												month: "long",
												day: "numeric",
											})}
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={4} className="h-32 text-center">
										<div className="flex flex-col items-center gap-2">
											<UsersIcon className="text-muted-foreground/40 size-8" />
											<div>
												<p className="text-muted-foreground font-medium">
													Nessun utente trovato
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

			{total > 0 && (
				<div className="text-muted-foreground flex items-center justify-between text-sm">
					<div>
						Pagina {page} di {totalPages}
					</div>
					<div>
						Totale: {total} utent{total === 1 ? "e" : "i"}
					</div>
				</div>
			)}
		</div>
	);
}
