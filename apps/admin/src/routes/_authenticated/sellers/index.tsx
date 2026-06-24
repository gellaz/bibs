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
import { toast } from "@bibs/ui/components/sonner";
import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { CheckCircle2Icon, SearchIcon, XCircleIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OnboardingStatusBadge } from "@/components/onboarding-status-badge";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";

type SellerStatus = "pending_review" | "active" | "rejected";
type SortByField = "name" | "createdAt";
type SortOrder = "asc" | "desc";

const STATUS_TABS = [
	{ value: "all", label: "Tutte", badgeColor: "default" },
	{ value: "pending_review", label: "In revisione", badgeColor: "warning" },
	{ value: "active", label: "Approvate", badgeColor: "success" },
	{ value: "rejected", label: "Rifiutate", badgeColor: "destructive" },
] as const;

export const Route = createFileRoute("/_authenticated/sellers/")({
	component: SellersPage,
	validateSearch: (search: Record<string, unknown>) => ({
		status: (search.status as string) || undefined,
	}),
});

interface Seller {
	id: string;
	userId: string;
	onboardingStatus: string;
	firstName: string | null;
	lastName: string | null;
	createdAt: string | Date;
	user: {
		id: string;
		name: string;
		email: string;
	};
	organization: {
		id: string;
		businessName: string;
		vatNumber: string;
		vatStatus: string;
	} | null;
}

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
};

function SellersPage() {
	"use no memo";

	const { status } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();

	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [sortBy, setSortBy] = useState<SortByField>("createdAt");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	const [confirmAction, setConfirmAction] = useState<{
		type: "verify" | "reject";
		seller: Seller;
	} | null>(null);

	const activeTab = status ?? "all";

	// Cambiando tab azzeriamo ricerca e pagina.
	useEffect(() => {
		setPage(1);
		setSearch("");
	}, [status]);

	// La ricerca deboundata riporta sempre alla prima pagina.
	useEffect(() => {
		setPage(1);
	}, [debouncedSearch]);

	const sorting: SortingState = [{ id: sortBy, desc: sortOrder === "desc" }];

	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		if (head) {
			setSortBy(head.id as SortByField);
			setSortOrder(head.desc ? "desc" : "asc");
		} else {
			// SortableHeader rimuove l'ordinamento al terzo clic: torniamo al
			// default (più recenti) invece di lasciare la query senza ordine.
			setSortBy("createdAt");
			setSortOrder("desc");
		}
		setPage(1);
	};

	const { data: countsData } = useQuery({
		queryKey: ["admin-sellers-counts"],
		queryFn: async () => {
			const response = await api().admin.sellers.counts.get();
			if (response.error) return null;
			return response.data?.data ?? null;
		},
	});

	const { data, isLoading, error } = useQuery({
		queryKey: [
			"admin-sellers",
			status,
			page,
			limit,
			debouncedSearch,
			sortBy,
			sortOrder,
		],
		queryFn: async () => {
			const response = await api().admin.sellers.get({
				query: {
					page,
					limit,
					...(status ? { status: status as SellerStatus } : {}),
					...(debouncedSearch ? { search: debouncedSearch } : {}),
					sortBy,
					sortOrder,
				},
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento venditori",
				);
			}

			return response.data;
		},
	});

	const verifyMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).verify.patch();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella verifica",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
			void queryClient.invalidateQueries({
				queryKey: ["admin-sellers-counts"],
			});
			setConfirmAction(null);
			toast.success("Venditore approvato con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'approvazione");
		},
	});

	const rejectMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).reject.patch();
			if (response.error) {
				throw new Error(response.error.value?.message || "Errore nel rifiuto");
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
			void queryClient.invalidateQueries({
				queryKey: ["admin-sellers-counts"],
			});
			setConfirmAction(null);
			toast.success("Venditore rifiutato");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante il rifiuto");
		},
	});

	const handleConfirm = () => {
		if (!confirmAction) return;
		if (confirmAction.type === "verify") {
			verifyMutation.mutate(confirmAction.seller.id);
		} else {
			rejectMutation.mutate(confirmAction.seller.id);
		}
	};

	const handleTabChange = (value: string) => {
		void navigate({
			search: {
				status: value === "all" ? undefined : value,
			},
		});
	};

	const isMutating = verifyMutation.isPending || rejectMutation.isPending;

	const showActions = !status || status === "pending_review";

	const sellerTabs: TabNavItem[] = STATUS_TABS.map((tab) => ({
		value: tab.value,
		label: tab.label,
		badgeColor: tab.badgeColor,
		count:
			tab.value === "all"
				? countsData
					? (countsData.pending_review ?? 0) +
						(countsData.active ?? 0) +
						(countsData.rejected ?? 0)
					: null
				: countsData
					? (countsData[
							tab.value as "pending_review" | "active" | "rejected"
						] ?? 0)
					: null,
	}));

	const rows = useMemo<Seller[]>(() => (data?.data as Seller[]) ?? [], [data]);

	const columns = useMemo<ColumnDef<Seller>[]>(() => {
		const cols: ColumnDef<Seller>[] = [
			{
				id: "name",
				accessorFn: (row) =>
					row.firstName && row.lastName
						? `${row.firstName} ${row.lastName}`
						: row.user.name,
				enableHiding: false,
				enableSorting: true,
				meta: {
					menuLabel: "Venditore",
					headerClassName: "pl-4",
					cellClassName: "pl-6 font-semibold",
				},
				header: ({ column }) => (
					<SortableHeader column={column}>Venditore</SortableHeader>
				),
				cell: ({ row }) => {
					const s = row.original;
					return (
						<Link
							to="/sellers/$sellerId"
							params={{ sellerId: s.id }}
							className="hover:text-primary hover:underline"
						>
							{s.firstName && s.lastName
								? `${s.firstName} ${s.lastName}`
								: s.user.name}
						</Link>
					);
				},
			},
			{
				id: "email",
				header: "Email",
				meta: { cellClassName: "text-muted-foreground text-sm" },
				cell: ({ row }) => row.original.user.email,
			},
			{
				id: "organization",
				header: "Azienda",
				meta: { cellClassName: "text-sm" },
				cell: ({ row }) =>
					row.original.organization?.businessName ?? (
						<span className="text-muted-foreground">—</span>
					),
			},
			{
				id: "vatNumber",
				header: "P.IVA",
				meta: { cellClassName: "text-sm" },
				cell: ({ row }) =>
					row.original.organization ? (
						<code className="text-xs">
							{row.original.organization.vatNumber}
						</code>
					) : (
						<span className="text-muted-foreground">—</span>
					),
			},
		];

		if (!status) {
			cols.push({
				id: "onboardingStatus",
				header: "Stato",
				cell: ({ row }) => (
					<OnboardingStatusBadge status={row.original.onboardingStatus} />
				),
			});
		}

		cols.push({
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
		});

		if (showActions) {
			cols.push({
				id: "actions",
				enableHiding: false,
				meta: {
					headerClassName: "pr-6 text-right",
					cellClassName: "pr-6 text-right",
				},
				header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
				cell: ({ row }) => {
					const s = row.original;
					if (s.onboardingStatus !== "pending_review") return null;
					return (
						<div className="flex items-center justify-end gap-1.5">
							<Button
								variant="success"
								size="sm"
								onClick={() => setConfirmAction({ type: "verify", seller: s })}
							>
								<CheckCircle2Icon className="size-3.5" />
								Approva
							</Button>
							<Button
								variant="destructive"
								size="sm"
								onClick={() => setConfirmAction({ type: "reject", seller: s })}
							>
								<XCircleIcon className="size-3.5" />
								Rifiuta
							</Button>
						</div>
					);
				},
			});
		} else {
			// When actions are hidden, still need a column to host the toggle.
			cols.push({
				id: "toggle",
				enableHiding: false,
				meta: { headerClassName: "w-12 pr-6 text-right" },
				header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
				cell: () => null,
			});
		}

		return cols;
	}, [status, showActions]);

	return (
		<div className="space-y-4">
			<PageHeader
				title="Venditori"
				description="Gestisci le candidature dei venditori"
			/>

			<TabNav
				tabs={sellerTabs}
				activeTab={activeTab}
				onTabChange={handleTabChange}
			/>

			<InputGroup className="max-w-md">
				<InputGroupAddon align="inline-start">
					<SearchIcon />
				</InputGroupAddon>
				<InputGroupInput
					placeholder="Cerca per nome, email, azienda o P.IVA..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					aria-label="Cerca venditori"
				/>
				{search.length > 0 && (
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							size="icon-xs"
							onClick={() => setSearch("")}
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
				storageKey="admin.sellers.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				manualSorting={{ sorting, onSortingChange }}
				hideHeaderWhenEmpty={!debouncedSearch}
				emptyState={
					debouncedSearch ? (
						<EmptyState
							variant="no-results"
							title="Nessun risultato"
							description={`Nessun venditore corrisponde a "${debouncedSearch}".`}
						/>
					) : (
						<EmptyState
							variant="empty"
							title="Nessun venditore"
							description={
								status === "pending_review"
									? "Nessuna candidatura in attesa di revisione."
									: status === "rejected"
										? "Nessuna candidatura rifiutata."
										: status === "active"
											? "Nessun venditore attivo."
											: "Le nuove candidature appariranno qui."
							}
						/>
					)
				}
			/>

			{data?.pagination &&
				data.pagination.total > 0 &&
				(() => {
					const total = data.pagination.total;
					const totalPages = Math.ceil(total / limit);
					const rangeStart = (page - 1) * limit + 1;
					const rangeEnd = Math.min(page * limit, total);
					return (
						<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
							<p className="text-muted-foreground text-sm tabular-nums">
								{rangeStart}–{rangeEnd} di {total} venditor
								{total === 1 ? "e" : "i"}
							</p>
							<div className="flex items-center gap-4">
								<PageSizeSelector
									pageSize={limit}
									onPageSizeChange={(size) => {
										setLimit(size);
										setPage(1);
									}}
								/>
								<DataPagination
									page={page}
									totalPages={totalPages}
									onPageChange={setPage}
								/>
							</div>
						</div>
					);
				})()}

			<AlertDialog
				open={!!confirmAction}
				onOpenChange={(open) => {
					if (!open) setConfirmAction(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmAction?.type === "verify"
								? "Approva venditore"
								: "Rifiuta venditore"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmAction?.type === "verify" ? (
								<>
									Sei sicuro di voler approvare{" "}
									<strong>
										{confirmAction.seller.organization?.businessName ??
											confirmAction.seller.user.name}
									</strong>
									? Il venditore potrà iniziare a operare sulla piattaforma.
								</>
							) : (
								<>
									Sei sicuro di voler rifiutare{" "}
									<strong>
										{confirmAction?.seller.organization?.businessName ??
											confirmAction?.seller.user.name}
									</strong>
									? Il venditore dovrà aggiornare i dati e ripresentare la
									richiesta.
								</>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isMutating}>Annulla</AlertDialogCancel>
						<AlertDialogAction
							variant={
								confirmAction?.type === "verify" ? "success" : "destructive"
							}
							onClick={handleConfirm}
							disabled={isMutating}
						>
							{isMutating
								? "Attendere..."
								: confirmAction?.type === "verify"
									? "Approva"
									: "Rifiuta"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
