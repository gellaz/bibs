import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useStores } from "@/hooks/use-stores";
import { api } from "@/lib/api";

const STORAGE_KEY = "bibs-seller-active-store";

interface Store {
	id: string;
	name: string;
	addressLine1: string;
	municipality: { name: string; provinceAcronym: string } | null;
}

export interface Subscription {
	storeId: string;
	storeName: string;
	status: string;
	feeAmountCents: number;
	currency: string;
	currentPeriodEnd: Date;
	cancelAtPeriodEnd: boolean;
	suspendedAt: Date | null;
}

interface ActiveStoreContextValue {
	/** Currently selected store, or null if none/loading */
	activeStore: Store | null;
	/** Subscription for the currently selected store, or null if not found */
	activeSubscription: Subscription | null;
	/** All available stores */
	stores: Store[];
	/** Whether stores are still loading */
	isLoading: boolean;
	/** Select a store by ID */
	setActiveStoreId: (storeId: string) => void;
}

const ActiveStoreContext = createContext<ActiveStoreContextValue | null>(null);

export function ActiveStoreProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const { data: stores, isLoading } = useStores();
	const [activeStoreId, setActiveStoreIdState] = useState<string | null>(() => {
		if (typeof window === "undefined") return null;
		return window.localStorage.getItem(STORAGE_KEY);
	});

	const { data: subscriptions } = useQuery({
		queryKey: ["seller", "billing", "subscriptions"],
		queryFn: async () => {
			const r = await api().seller.billing.subscriptions.get();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return (r.data?.data ?? []) as Subscription[];
		},
	});

	const setActiveStoreId = useCallback((storeId: string) => {
		setActiveStoreIdState(storeId);
		window.localStorage.setItem(STORAGE_KEY, storeId);
	}, []);

	// Auto-select first store if none is selected or stored ID is invalid
	useEffect(() => {
		if (!stores || stores.length === 0) return;

		const isValid = activeStoreId && stores.some((s) => s.id === activeStoreId);
		if (!isValid) {
			setActiveStoreId(stores[0].id);
		}
	}, [stores, activeStoreId, setActiveStoreId]);

	const activeStore = useMemo(() => {
		if (!stores || !activeStoreId) return null;
		return stores.find((s) => s.id === activeStoreId) ?? null;
	}, [stores, activeStoreId]);

	const activeSubscription = useMemo(() => {
		if (!subscriptions || !activeStoreId) return null;
		return subscriptions.find((s) => s.storeId === activeStoreId) ?? null;
	}, [subscriptions, activeStoreId]);

	const value = useMemo<ActiveStoreContextValue>(
		() => ({
			activeStore,
			activeSubscription,
			stores: stores ?? [],
			isLoading,
			setActiveStoreId,
		}),
		[activeStore, activeSubscription, stores, isLoading, setActiveStoreId],
	);

	return (
		<ActiveStoreContext.Provider value={value}>
			{children}
		</ActiveStoreContext.Provider>
	);
}

export function useActiveStore() {
	const ctx = useContext(ActiveStoreContext);
	if (!ctx) {
		throw new Error("useActiveStore must be used within ActiveStoreProvider");
	}
	return ctx;
}

export function useIsStoreReadOnly(): boolean {
	const { activeSubscription } = useActiveStore();
	return activeSubscription?.status === "suspended";
}
