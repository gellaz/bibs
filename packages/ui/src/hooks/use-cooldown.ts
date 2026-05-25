import { useEffect, useState } from "react";

export type UseCooldownResult = {
	remaining: number; // milliseconds
	secondsRemaining: number; // ceil(remaining / 1000)
	ready: boolean;
};

/**
 * Cooldown timer driven by an `startedAt` epoch (ms) and a `durationMs`.
 *
 * - Returns `ready: true` when `startedAt` is null OR when now - startedAt >= durationMs.
 * - Re-renders every ~1s while running, until ready.
 * - Cleans up the interval on unmount or when startedAt changes.
 *
 * The hook does NOT call back when ready — the consumer reads `ready` from the
 * return value to decide whether to enable a button etc.
 */
export function useCooldown(
	startedAt: number | null,
	durationMs: number,
): UseCooldownResult {
	const compute = (): UseCooldownResult => {
		if (startedAt == null) {
			return { remaining: 0, secondsRemaining: 0, ready: true };
		}
		const elapsed = Date.now() - startedAt;
		const remaining = Math.max(0, durationMs - elapsed);
		return {
			remaining,
			secondsRemaining: Math.ceil(remaining / 1000),
			ready: remaining === 0,
		};
	};

	const [state, setState] = useState<UseCooldownResult>(compute);

	useEffect(() => {
		// Recompute immediately when inputs change.
		setState(compute());

		if (startedAt == null) return;
		const now = Date.now();
		if (now - startedAt >= durationMs) return;

		const id = setInterval(() => {
			const next = compute();
			setState(next);
			if (next.ready) clearInterval(id);
		}, 1000);

		return () => clearInterval(id);
		// biome-ignore lint/correctness/useExhaustiveDependencies: `compute` is a stable closure that already captures `startedAt` and `durationMs`, which are the real inputs.
	}, [startedAt, durationMs]);

	return state;
}
