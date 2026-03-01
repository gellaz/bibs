import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useStores } from "@/hooks/use-stores";

const STORAGE_KEY = "bibs-seller-active-store";

interface Store {
	id: string;
	name: string;
	city: string;
	addressLine1: string;
	province: string | null;
}

interface ActiveStoreContextValue {
	/** Currently selected store, or null if none/loading */
	activeStore: Store | null;
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

	const value = useMemo<ActiveStoreContextValue>(
		() => ({
			activeStore,
			stores: stores ?? [],
			isLoading,
			setActiveStoreId,
		}),
		[activeStore, stores, isLoading, setActiveStoreId],
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
