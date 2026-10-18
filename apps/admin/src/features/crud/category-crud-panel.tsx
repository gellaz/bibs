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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@bibs/ui/components/dropdown-menu";
import { toast } from "@bibs/ui/components/sonner";
import { DataTable, SortableHeader } from "@bibs/ui/custom/data-table";
import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { SearchInput } from "@bibs/ui/custom/search-input";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { useRowSelection } from "@bibs/ui/hooks/use-row-selection";
import { unwrap as unwrapResponse } from "@bibs/ui/lib/api-client";
import { formatDate } from "@bibs/ui/lib/date";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { PencilIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import {
	BulkToolbar,
	RowActionsMenu,
	selectColumn,
} from "@/components/bulk-selection";
import {
	CsvImportDialog,
	type CsvImportResult,
} from "@/features/csv-import/components/csv-import-dialog";
import { runBulk, toastBulkResult } from "@/lib/bulk";
import {
	dataTableFooterLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

type SortByField = "name" | "createdAt";
type SortOrder = "asc" | "desc";

const EMPTY: never[] = [];

// Eden responses are { data, error }. The error shape is per-route, so keep it
// `unknown` here — that way any config closure's eden promise is assignable —
// and narrow it at runtime in `edenMessage` (@bibs/ui).
type EdenRes<T> = { data: T | null; error: unknown };

// Condiviso con il resto dei FE: lancia un `ApiError` con lo status, così la
// policy di retry del QueryClient non riprova i 4xx.
async function unwrap<T>(p: Promise<EdenRes<T>>, fallback: string): Promise<T> {
	return unwrapResponse(await p, fallback);
}

export interface CategoryEntity {
	id: string;
	name: string;
	createdAt: Date | string;
}

export interface CrudListResult<T> {
	data: T[];
	pagination: { total: number };
}

export interface CrudListQuery {
	page: number;
	limit: number;
	search?: string;
	sortBy: SortByField;
	sortOrder: SortOrder;
	[filterKey: string]: string | number | undefined;
}

export interface CrudFormProps<TForm> {
	defaultValues?: TForm;
	onSubmit: (data: TForm) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export interface CategoryCrudConfig<TEntity extends CategoryEntity, TForm> {
	queryKeyBase: string;
	storageKey: string;
	extraInvalidate?: readonly (readonly string[])[];

	list: (q: CrudListQuery) => Promise<EdenRes<CrudListResult<TEntity>>>;
	create: (form: TForm) => Promise<EdenRes<unknown>>;
	update: (id: string, form: TForm) => Promise<EdenRes<unknown>>;
	remove: (id: string, entity: TEntity) => Promise<EdenRes<unknown>>;

	// Funzioni e non costanti: i testi vanno letti a ogni render, nella lingua
	// corrente (anche in SSR).
	extraColumns?: () => DataTableColumnDef<TEntity>[];

	renderForm: (p: CrudFormProps<TForm>) => ReactNode;
	editDefaults: (e: TEntity) => TForm;

	toolbarFilter?: (ctx: {
		values: Record<string, string>;
		set: (key: string, value: string) => void;
	}) => ReactNode;
	csvImport?: {
		onImport: (file: File) => Promise<CsvImportResult>;
		labels: () => { title: string; description: string; formatHint: string };
	};

	labels: () => {
		searchPlaceholder: string;
		empty: { title: string; subtitle: string };
		total: (n: number) => string;
		createDialog: { title: string; description: string };
		editDialog: { title: string; description: string };
		deleteDescription: (name: string, entity: TEntity) => ReactNode;
		// Da due voci in su; senza, un testo generico.
		bulkDeleteDescription?: (entities: TEntity[]) => ReactNode;
		toasts: { createOk: string; updateOk: string; deleteOk: string };
	};
}

interface CategoryCrudPanelProps<TEntity extends CategoryEntity, TForm> {
	config: CategoryCrudConfig<TEntity, TForm>;
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

export function CategoryCrudPanel<TEntity extends CategoryEntity, TForm>({
	config,
	createOpen,
	onCreateOpenChange,
}: CategoryCrudPanelProps<TEntity, TForm>) {
	"use no memo";

	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);
	const [search, setSearch] = useState("");
	const [sortBy, setSortBy] = useState<SortByField>("name");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
	const [filterValues, setFilterValues] = useState<Record<string, string>>({});
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [selected, setSelected] = useState<TEntity | null>(null);

	const sorting: SortingState = [{ id: sortBy, desc: sortOrder === "desc" }];

	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		if (head) {
			setSortBy(head.id as SortByField);
			setSortOrder(head.desc ? "desc" : "asc");
		} else {
			// Il terzo clic toglie l'ordinamento: torna al default (nome A→Z).
			setSortBy("name");
			setSortOrder("asc");
		}
		setPage(1);
	};

	const setFilterValue = (key: string, value: string) => {
		setFilterValues((prev) => ({ ...prev, [key]: value }));
		setPage(1);
	};

	const activeFilters = useMemo(() => {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(filterValues)) if (v) out[k] = v;
		return out;
	}, [filterValues]);

	const { data, isLoading, error } = useQuery({
		queryKey: [
			config.queryKeyBase,
			page,
			limit,
			search,
			sortBy,
			sortOrder,
			activeFilters,
		],
		queryFn: () =>
			unwrap(
				config.list({
					page,
					limit,
					...(search ? { search } : {}),
					sortBy,
					sortOrder,
					...activeFilters,
				}),
				m.crud_load_error(),
			),
	});

	const rows = data?.data ?? EMPTY;
	// La selezione vale per la pagina in vista: cambiando pagina, ricerca,
	// filtri o ordinamento si riparte. Così ogni voce selezionata è una riga a
	// schermo, con i dati (es. i valori da confermare) per eliminarla.
	const selection = useRowSelection({
		currentPageIds: rows.map((r) => r.id),
		resetKey: JSON.stringify([
			page,
			limit,
			search,
			sortBy,
			sortOrder,
			activeFilters,
		]),
	});
	const selectedRows = rows.filter((r) => selection.isSelected(r.id));
	const selectionRef = useRef(selection);
	selectionRef.current = selection;

	const invalidateAll = () => {
		void queryClient.invalidateQueries({ queryKey: [config.queryKeyBase] });
		for (const key of config.extraInvalidate ?? []) {
			void queryClient.invalidateQueries({ queryKey: [...key] });
		}
	};

	const createMutation = useMutation({
		mutationFn: (form: TForm) =>
			unwrap(config.create(form), m.common_create_error()),
		onSuccess: () => {
			invalidateAll();
			onCreateOpenChange(false);
			toast.success(config.labels().toasts.createOk);
		},
		onError: (e: Error) => toast.error(e.message || m.common_create_error()),
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, form }: { id: string; form: TForm }) =>
			unwrap(config.update(id, form), m.common_update_error()),
		onSuccess: () => {
			invalidateAll();
			setEditOpen(false);
			setSelected(null);
			toast.success(config.labels().toasts.updateOk);
		},
		onError: (e: Error) => {
			// The 409 means the count the form confirmed against is stale.
			// Invalidating refetches the list; the dialog stays open (it reads
			// `current`, derived from the fresh row) so a retry sends the real
			// count instead of looping on the same confirmation forever.
			invalidateAll();
			toast.error(e.message || m.common_update_error());
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (entity: TEntity) =>
			unwrap(config.remove(entity.id, entity), m.common_delete_error()),
		onSuccess: () => {
			invalidateAll();
			setDeleteOpen(false);
			setSelected(null);
			toast.success(config.labels().toasts.deleteOk);
		},
		onError: (e: Error) => {
			// Same reasoning as above: refetch so the confirmation dialog (still
			// open, reading `current`) shows the up-to-date count on retry.
			invalidateAll();
			toast.error(e.message || m.common_delete_error());
		},
	});

	const bulkDeleteMutation = useMutation({
		mutationFn: (entities: TEntity[]) =>
			runBulk(entities, (e) =>
				unwrap(config.remove(e.id, e), m.common_delete_error()),
			),
		onSuccess: (result) => {
			invalidateAll();
			setBulkDeleteOpen(false);
			selection.clear();
			toastBulkResult(result, {
				done: (n) =>
					n === 1
						? config.labels().toasts.deleteOk
						: m.crud_bulk_delete_ok({ count: n }),
				error: m.common_delete_error(),
			});
		},
	});

	// Dialogs are opened with the row captured at click time (`selected`), but
	// a 409 refetches the list: re-deriving `current` from the fresh data on
	// every render is what makes the retry send the real, up-to-date count
	// instead of the stale one `selected` was opened with.
	const current =
		(selected && data?.data.find((e) => e.id === selected.id)) ?? selected;

	const handleDelete = () => {
		if (!current) return;
		deleteMutation.mutate(current);
	};

	const labels = config.labels();
	const csvLabels = config.csvImport?.labels();

	const columns = useMemo<DataTableColumnDef<TEntity>[]>(() => {
		const nameCol: DataTableColumnDef<TEntity> = {
			id: "name",
			accessorFn: (row) => row.name,
			enableHiding: false,
			enableSorting: true,
			meta: { menuLabel: m.common_name(), cellClassName: "font-semibold" },
			header: ({ column }) => (
				<SortableHeader column={column}>{m.common_name()}</SortableHeader>
			),
			cell: ({ row }) => row.original.name,
		};
		const createdAtCol: DataTableColumnDef<TEntity> = {
			id: "createdAt",
			accessorFn: (row) => row.createdAt,
			enableSorting: true,
			meta: {
				menuLabel: m.crud_column_created_at_menu(),
				cellClassName: "text-muted-foreground text-sm",
			},
			header: ({ column }) => (
				<SortableHeader column={column}>
					{m.crud_column_created_at()}
				</SortableHeader>
			),
			cell: ({ row }) => formatDate(row.original.createdAt, { long: true }),
		};
		const actionsCol: DataTableColumnDef<TEntity> = {
			id: "actions",
			enableHiding: false,
			meta: {
				// px-2: il pulsante icona (32 px) entra giusto nei 48 px di w-12.
				headerClassName: "w-12 px-2",
				cellClassName: "w-12 px-2",
				sticky: "right",
			},
			header: ({ table }) => (
				<div className="flex justify-center">
					<TableColumnsToggle
						table={table}
						labels={tableColumnsToggleLabels()}
						align="end"
					/>
				</div>
			),
			cell: ({ row }) => (
				<RowActionsMenu name={row.original.name}>
					<DropdownMenuItem
						className="whitespace-nowrap"
						onSelect={() => {
							setSelected(row.original);
							setEditOpen(true);
						}}
					>
						<PencilIcon />
						{m.common_edit()}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						className="whitespace-nowrap"
						onSelect={() => {
							setSelected(row.original);
							setDeleteOpen(true);
						}}
					>
						<Trash2Icon />
						{m.common_delete()}
					</DropdownMenuItem>
				</RowActionsMenu>
			),
		};
		return [
			selectColumn<TEntity>(() => selectionRef.current),
			nameCol,
			...(config.extraColumns?.() ?? []),
			createdAtCol,
			actionsCol,
		];
	}, [config]);

	const isFiltered = search.length > 0 || Object.keys(activeFilters).length > 0;

	return (
		<div className="space-y-4">
			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						{m.common_load_error_with_message({
							message: (error as Error).message,
						})}
					</p>
				</div>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<SearchInput
					value={search}
					onValueChange={(q) => {
						setSearch(q);
						setPage(1);
					}}
					placeholder={labels.searchPlaceholder}
					aria-label={labels.searchPlaceholder}
					clearLabel={m.common_clear_search()}
					className="min-w-60 flex-1"
				/>
				{config.toolbarFilter?.({ values: filterValues, set: setFilterValue })}
				{config.csvImport && (
					<Button variant="outline" onClick={() => setImportOpen(true)}>
						<UploadIcon />
						<span>{m.crud_import_csv()}</span>
					</Button>
				)}
			</div>

			<BulkToolbar count={selectedRows.length} onClear={selection.clear}>
				<Button
					size="sm"
					variant="destructive"
					onClick={() => setBulkDeleteOpen(true)}
				>
					<Trash2Icon className="size-4" />
					{m.common_delete()}
				</Button>
			</BulkToolbar>

			<DataTable
				data={rows}
				columns={columns}
				storageKey={config.storageKey}
				getRowId={(row) => row.id}
				isLoading={isLoading}
				isRowSelected={(row) => selection.isSelected(row.original.id)}
				manualSorting={{ sorting, onSortingChange }}
				hideHeaderWhenEmpty={!isFiltered}
				emptyState={
					isFiltered ? (
						<EmptyState variant="no-results" title={m.common_no_results()} />
					) : (
						<EmptyState
							title={labels.empty.title}
							description={labels.empty.subtitle}
						/>
					)
				}
			/>

			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) => labels.total(r.total)}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) => {
					setLimit(size);
					setPage(1);
				}}
				onPageChange={setPage}
			/>

			<Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{labels.createDialog.title}</DialogTitle>
						<DialogDescription>
							{labels.createDialog.description}
						</DialogDescription>
					</DialogHeader>
					{config.renderForm({
						onSubmit: (form) => createMutation.mutate(form),
						onCancel: () => onCreateOpenChange(false),
						isPending: createMutation.isPending,
						submitLabel: m.common_create(),
						pendingLabel: m.common_creating(),
					})}
				</DialogContent>
			</Dialog>

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{labels.editDialog.title}</DialogTitle>
						<DialogDescription>
							{labels.editDialog.description}
						</DialogDescription>
					</DialogHeader>
					{selected && current && (
						<div key={selected.id}>
							{config.renderForm({
								defaultValues: config.editDefaults(current),
								onSubmit: (form) =>
									updateMutation.mutate({ id: selected.id, form }),
								onCancel: () => {
									setEditOpen(false);
									setSelected(null);
								},
								isPending: updateMutation.isPending,
								submitLabel: m.common_save(),
								pendingLabel: m.common_saving(),
							})}
						</div>
					)}
				</DialogContent>
			</Dialog>

			{config.csvImport && csvLabels && (
				<CsvImportDialog
					open={importOpen}
					onOpenChange={setImportOpen}
					title={csvLabels.title}
					description={csvLabels.description}
					formatHint={csvLabels.formatHint}
					onImport={config.csvImport.onImport}
					onSuccess={invalidateAll}
				/>
			)}

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{m.common_confirm_delete_title()}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{current ? labels.deleteDescription(current.name, current) : null}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDeleteOpen(false);
								setSelected(null);
							}}
						>
							{m.common_cancel()}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending
								? m.common_deleting()
								: m.common_delete()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{m.common_confirm_delete_title()}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedRows.length === 1
								? labels.deleteDescription(
										selectedRows[0].name,
										selectedRows[0],
									)
								: (labels.bulkDeleteDescription?.(selectedRows) ??
									m.crud_bulk_delete_description({
										count: selectedRows.length,
									}))}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={(e) => {
								// Resta aperto finché le chiamate non finiscono.
								e.preventDefault();
								bulkDeleteMutation.mutate(selectedRows);
							}}
							disabled={bulkDeleteMutation.isPending}
						>
							{bulkDeleteMutation.isPending
								? m.common_deleting()
								: m.common_delete()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
