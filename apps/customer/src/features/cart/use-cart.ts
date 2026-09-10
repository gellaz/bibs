import { toast } from "@bibs/ui/components/sonner";
import { unwrap } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

const CART_KEY = ["cart"] as const;

// `unwrap` (da @bibs/ui/lib/api-client) lancia il messaggio dell'API se c'è,
// altrimenti il fallback: è così che il testo specifico del server — "Ne
// restano solo 3" — arriva intatto al toast. Non riscrivere quella logica.
async function fetchCart() {
	const res = await api().customer.cart.get();
	return unwrap(res, m.cart_load_failed()).data;
}

// I tipi vengono dall'API via Eden: nessun DTO scritto a mano da tenere in sync.
export type CartData = Awaited<ReturnType<typeof fetchCart>>;
export type CartGroup = CartData["groups"][number];
export type CartLine = CartGroup["items"][number];

/**
 * Unica fonte di verità del carrello sul frontend: pulsante, stepper, badge e
 * pagina leggono tutti da questa query. Nessuno stato locale che duplichi il
 * server — dopo ogni mutation si invalida e si rilegge.
 */
export function useCart() {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: CART_KEY });

	const cartQuery = useQuery({
		queryKey: CART_KEY,
		staleTime: 30_000,
		queryFn: fetchCart,
	});

	const cart = cartQuery.data;

	// Indice per storeProductId: la tile del catalogo deve sapere in O(1) se quel
	// prodotto è già nel carrello e in che quantità.
	const linesByStoreProductId = useMemo(() => {
		const map = new Map<string, CartLine>();
		for (const group of cart?.groups ?? [])
			for (const item of group.items) map.set(item.storeProductId, item);
		return map;
	}, [cart]);

	const addItem = useMutation({
		mutationFn: async (vars: { storeProductId: string; quantity: number }) => {
			const res = await api().customer.cart.items.post(vars);
			return unwrap(res, m.error_generic()).data;
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.cart_item_added());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const setQuantity = useMutation({
		mutationFn: async (vars: { cartItemId: string; quantity: number }) => {
			const res = await api()
				.customer.cart.items({ id: vars.cartItemId })
				.patch({ quantity: vars.quantity });
			return unwrap(res, m.error_generic()).data;
		},
		onSuccess: () => void invalidate(),
		onError: (e: Error) => toast.error(e.message),
	});

	const removeItem = useMutation({
		mutationFn: async (cartItemId: string) => {
			const res = await api().customer.cart.items({ id: cartItemId }).delete();
			unwrap(res, m.error_generic());
		},
		onSuccess: () => void invalidate(),
		onError: (e: Error) => toast.error(e.message),
	});

	return {
		cart,
		isPending: cartQuery.isPending,
		isError: cartQuery.isError,
		refetch: cartQuery.refetch,
		linesByStoreProductId,
		addItem,
		setQuantity,
		removeItem,
	};
}
