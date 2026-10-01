import { Slot } from "radix-ui";
import type * as React from "react";

import { Button } from "~/components/button";
import { CreateIcon } from "~/icons";

/**
 * CTA di creazione entità: un Button con il glifo di creazione
 * (`CreateIcon`) fissato per costruzione, così nessun call-site può
 * divergere. Supporta `asChild`: l'icona viene iniettata DENTRO il
 * child via `Slottable`, quindi con un `<Link>` resta parte della hit
 * area dell'anchor.
 *
 * ```tsx
 * <CreateButton asChild>
 *   <Link to="/products/new">Nuovo Prodotto</Link>
 * </CreateButton>
 *
 * <CreateButton onClick={() => setCreateOpen(true)}>
 *   Nuova Categoria
 * </CreateButton>
 * ```
 */
function CreateButton({
	children,
	...props
}: React.ComponentProps<typeof Button>) {
	return (
		<Button {...props}>
			<CreateIcon />
			<Slot.Slottable>{children}</Slot.Slottable>
		</Button>
	);
}

export { CreateButton };
