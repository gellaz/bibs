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
import { Input } from "@bibs/ui/components/input";
import { toast } from "@bibs/ui/components/sonner";
import { DataPagination } from "@bibs/ui/custom/data-pagination";
import { DataTable } from "@bibs/ui/custom/data-table";
import { PageSizeSelector } from "@bibs/ui/custom/page-size-selector";
import type { SortOrder } from "@bibs/ui/custom/sortable-table-head";
import { SortableHeadButton } from "@bibs/ui/custom/sortable-table-head";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import { unwrap as unwrapResponse } from "@bibs/ui/lib/api-client";
import { formatDate } from "@bibs/ui/lib/date";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
	CsvImportDialog,
	type CsvImportResult,
} from "@/features/csv-import/components/csv-import-dialog";
import {
	dataPaginationLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

type SortByField = "name" | "createdAt";

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
	emptyIcon: ReactNode;

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
		toasts: { createOk: string; updateOk: string; deleteOk: string };
		rowAria: { edit: string; delete: string };
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
	const debouncedSearch = useDebouncedValue(search, 300);
	const [sortBy, setSortBy] = useState<SortByField>("name");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
	const [filterValues, setFilterValues] = useState<Record<string, string>>({});
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [selected, setSelected] = useState<TEntity | null>(null);

	const handleSort = (field: SortByField) => {
		if (sortBy === field) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(field);
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
			debouncedSearch,
			sortBy,
			sortOrder,
			activeFilters,
		],
		queryFn: () =>
			unwrap(
				config.list({
					page,
					limit,
					...(debouncedSearch ? { search: debouncedSearch } : {}),
					sortBy,
					sortOrder,
					...activeFilters,
				}),
				m.crud_load_error(),
			),
	});

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
			enableHiding: false,
			meta: {
				menuLabel: m.common_name(),
				headerClassName: "pl-4",
				cellClassName: "pl-6 font-semibold",
			},
			header: () => (
				<SortableHeadButton
					active={sortBy === "name"}
					sortOrder={sortOrder}
					onSort={() => handleSort("name")}
				>
					{m.common_name()}
				</SortableHeadButton>
			),
			cell: ({ row }) => row.original.name,
		};
		const createdAtCol: DataTableColumnDef<TEntity> = {
			id: "createdAt",
			meta: {
				menuLabel: m.crud_column_created_at_menu(),
				cellClassName: "text-muted-foreground text-sm",
			},
			header: () => (
				<SortableHeadButton
					active={sortBy === "createdAt"}
					sortOrder={sortOrder}
					onSort={() => handleSort("createdAt")}
				>
					{m.crud_column_created_at()}
				</SortableHeadButton>
			),
			cell: ({ row }) => formatDate(row.original.createdAt, { long: true }),
		};
		const actionsCol: DataTableColumnDef<TEntity> = {
			id: "actions",
			enableHiding: false,
			meta: {
				headerClassName: "pr-6 text-right",
				cellClassName: "pr-6 text-right",
			},
			header: ({ table }) => (
				<TableColumnsToggle
					table={table}
					labels={tableColumnsToggleLabels()}
					align="end"
				/>
			),
			cell: ({ row }) => (
				<div className="flex items-center justify-end gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => {
							setSelected(row.original);
							setEditOpen(true);
						}}
						aria-label={config.labels().rowAria.edit}
					>
						<PencilIcon className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => {
							setSelected(row.original);
							setDeleteOpen(true);
						}}
						aria-label={config.labels().rowAria.delete}
					>
						<Trash2Icon className="size-4" />
					</Button>
				</div>
			),
		};
		return [
			nameCol,
			...(config.extraColumns?.() ?? []),
			createdAtCol,
			actionsCol,
		];
	}, [sortBy, sortOrder, config]);

	const rows = data?.data ?? EMPTY;

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

			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						placeholder={labels.searchPlaceholder}
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(1);
						}}
						className="pl-9"
					/>
				</div>
				{config.toolbarFilter?.({ values: filterValues, set: setFilterValue })}
				{config.csvImport && (
					<Button variant="outline" onClick={() => setImportOpen(true)}>
						<UploadIcon />
						<span>{m.crud_import_csv()}</span>
					</Button>
				)}
			</div>

			<DataTable
				data={rows}
				columns={columns}
				storageKey={config.storageKey}
				getRowId={(row) => row.id}
				isLoading={isLoading}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						{config.emptyIcon}
						<div>
							<p className="text-muted-foreground font-medium">
								{labels.empty.title}
							</p>
							<p className="text-muted-foreground/60 text-sm">
								{labels.empty.subtitle}
							</p>
						</div>
					</div>
				}
			/>

			{data?.pagination && data.pagination.total > 0 && (
				<div className="flex items-center justify-between">
					<div className="text-muted-foreground text-sm">
						{labels.total(data.pagination.total)}
					</div>
					<div className="flex items-center gap-4">
						<PageSizeSelector
							label={m.common_rows_per_page()}
							pageSize={limit}
							onPageSizeChange={(size) => {
								setLimit(size);
								setPage(1);
							}}
						/>
						<DataPagination
							labels={dataPaginationLabels()}
							page={page}
							totalPages={Math.ceil(data.pagination.total / limit)}
							onPageChange={setPage}
						/>
					</div>
				</div>
			)}

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
		</div>
	);
}
