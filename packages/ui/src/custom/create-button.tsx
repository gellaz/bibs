import type * as React from "react";

import { Button } from "~/components/button";
import { CreateIcon } from "~/icons";

/**
 * CTA di creazione entità: un Button con il glifo di creazione
 * (`CreateIcon`) fissato per costruzione, così nessun call-site può
 * divergere. Con `render` l'icona resta dentro l'elemento renderizzato,
 * quindi con un `<Link>` fa parte della hit area dell'anchor.
 *
 * ```tsx
 * <CreateButton nativeButton={false} render={<Link to="/products/new" />}>
 *   Nuovo Prodotto
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
			{children}
		</Button>
	);
}

export { CreateButton };
