import type * as React from "react";

import { Button } from "~/components/button";
import { CreateIcon } from "~/icons";

/**
 * CTA di creazione entità: un Button con il glifo di creazione
 * (`CreateIcon`) fissato per costruzione, così nessun call-site può
 * divergere. Per una CTA che naviga serve un link, non un Button (Base UI
 * gli darebbe role="button"): stesso glifo su un `<Link>` stilato.
 *
 * ```tsx
 * <Link to="/products/new" className={buttonVariants()}>
 *   <CreateIcon />
 *   Nuovo Prodotto
 * </Link>
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
