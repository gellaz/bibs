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
import { DataTable } from "@bibs/ui/components/data-table";
import { Input } from "@bibs/ui/components/input";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { toast } from "@bibs/ui/components/sonner";
import type { SortOrder } from "@bibs/ui/components/sortable-table-head";
import { SortableHeadButton } from "@bibs/ui/components/sortable-table-head";
import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	CheckCircle2Icon,
	SearchIcon,
	ShieldCheckIcon,
	XCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OnboardingStatusBadge } from "@/components/onboarding-status-badge";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";

type SellerStatus = "pending_review" | "active" | "rejected";
type SortByField = "name" | "createdAt";

const STATUS_TABS = [
	{ value: "all", label: "Tutte", badgeColor: "default" },
	{ value: "pending_review", label: "In revisione", badgeColor: "amber" },
	{ value: "active", label: "Approvate", badgeColor: "emerald" },
	{ value: "rejected", label: "Rifiutate", badgeColor: "red" },
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
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [sortBy, setSortBy] = useState<SortByField>("createdAt");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	const [confirmAction, setConfirmAction] = useState<{
		type: "verify" | "reject";
		seller: Seller;
	} | null>(null);

	const activeTab = status ?? "all";

	useEffect(() => {
		setPage(1);
		setSearch("");
		setDebouncedSearch("");
	}, [status]);

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		debounceRef.current = setTimeout(() => {
			setDebouncedSearch(search);
			setPage(1);
		}, 300);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [search]);

	const handleSort = (field: SortByField) => {
		if (sortBy === field) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(field);
			setSortOrder("asc");
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
				enableHiding: false,
				meta: {
					menuLabel: "Venditore",
					headerClassName: "pl-4",
					cellClassName: "pl-6 font-semibold",
				},
				header: () => (
					<SortableHeadButton
						active={sortBy === "name"}
						sortOrder={sortOrder}
						onSort={() => handleSort("name")}
					>
						Venditore
					</SortableHeadButton>
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
			meta: {
				menuLabel: "Registrato il",
				cellClassName: "text-muted-foreground text-sm",
			},
			header: () => (
				<SortableHeadButton
					active={sortBy === "createdAt"}
					sortOrder={sortOrder}
					onSort={() => handleSort("createdAt")}
				>
					Registrato il
				</SortableHeadButton>
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
	}, [status, showActions, sortBy, sortOrder]);

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

			<div className="relative">
				<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
				<Input
					placeholder="Cerca per nome, email, azienda o P.IVA..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="pl-9"
				/>
			</div>

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
				emptyState={
					<div className="flex flex-col items-center gap-2">
						<ShieldCheckIcon className="text-muted-foreground/40 size-8" />
						<div>
							<p className="text-muted-foreground font-medium">
								Nessun venditore trovato
							</p>
							<p className="text-muted-foreground/60 text-sm">
								{debouncedSearch
									? `Nessun risultato per "${debouncedSearch}"`
									: status === "pending_review"
										? "Nessuna candidatura in attesa di revisione"
										: status === "rejected"
											? "Nessuna candidatura rifiutata"
											: status === "active"
												? "Nessun venditore attivo"
												: "Le nuove candidature appariranno qui"}
							</p>
						</div>
					</div>
				}
			/>

			{data?.pagination &&
				data.pagination.total > 0 &&
				(() => {
					const totalPages = Math.ceil(data.pagination.total / limit);
					return (
						<div className="flex items-center justify-between">
							<div className="text-muted-foreground text-sm">
								Totale: {data.pagination.total} venditor
								{data.pagination.total === 1 ? "e" : "i"}
							</div>
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
