# Integrazione Frontend con Eden Treaty

Guida per integrare le app frontend TanStack Start con il backend Elysia API usando **Eden Treaty** per type-safety
end-to-end.

## Architettura

```text
┌──────────────────────────────────────────────────────┐
│  Monorepo bibs (Bun workspaces)                      │
│                                                      │
│  apps/api       → Elysia backend        :3000        │
│  apps/customer  → TanStack Start app    :3001        │
│  apps/seller    → TanStack Start app    :3002        │
│  apps/admin     → TanStack Start app    :3003        │
│                                                      │
│  packages/ui    → Componenti condivisi               │
└──────────────────────────────────────────────────────┘
```

Ogni app frontend usa **Eden Treaty** per chiamare l'API con type-safety completa. Non serve code generation — tutto
funziona con TypeScript inference dal tipo `App` esportato dal backend.

## Setup

### 1. Dipendenze

Nel `package.json` dell'app frontend:

```json
{
  "dependencies": {
    "@bibs/api": "workspace:*",
    "@elysiajs/eden": "^1.4.0"
  }
}
```

Poi:

```bash
bun install
```

### 2. Variabile d'ambiente

Aggiungere `VITE_API_URL` nel file `.env` dell'app frontend:

```bash
# .env
VITE_API_URL=http://localhost:3000
```

E nel config delle env (esempio con `@t3-oss/env-core`):

```typescript
client: {
    VITE_API_URL: z.string().url().default('http://localhost:3000'),
}
,
```

### 3. Client Eden Treaty

Creare `src/lib/api.ts`:

```typescript
import {treaty} from '@elysiajs/eden'
import {createIsomorphicFn} from '@tanstack/react-start'
import type {App} from '@bibs/api'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export const api = createIsomorphicFn()
    .server(() =>
        treaty<App>(API_URL, {
            fetch: {credentials: 'include' as RequestCredentials},
        }),
    )
    .client(() =>
        treaty<App>(API_URL, {
            fetch: {credentials: 'include' as RequestCredentials},
        }),
    )
```

`createIsomorphicFn` garantisce che il client venga creato correttamente sia durante SSR (loaders) che nel browser.

### 4. Tipo App dal backend

Il backend esporta il tipo `App` da `src/types.ts`:

```typescript
// apps/api/src/types.ts
export type {App} from "./index";
```

Questo è già configurato nel `package.json` del backend:

```json
{
  "exports": {
    ".": {
      "types": "./src/types.ts",
      "default": "./src/index.ts"
    }
  }
}
```

Le app frontend importano solo il **tipo** — nessun codice runtime del backend viene incluso nel bundle.

## Utilizzo

### Con TanStack Start Loaders (SSR)

I loaders eseguono sul server durante SSR e nel browser durante la navigazione client-side:

```tsx
import {createFileRoute} from '@tanstack/react-router'
import {api} from '#/lib/api'

export const Route = createFileRoute('/categories')({
    component: CategoriesPage,
    loader: async () => {
        const {data, error} = await api().admin.categories.get({
            query: {page: 1, limit: 50},
        })
        if (error) throw new Error(error.value.message)
        return data
    },
})

function CategoriesPage() {
    const data = Route.useLoaderData()

    return (
        <ul>
            {data.data.map((cat) => (
                <li key={cat.id}>{cat.name}</li>
            ))}
        </ul>
    )
}
```

### Con React Query (client-side)

Per data fetching reattivo con cache, pagination, refetch automatico:

```tsx
import {createFileRoute} from '@tanstack/react-router'
import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query'
import {api} from '#/lib/api'

export const Route = createFileRoute('/sellers')({
    component: SellersPage,
})

function SellersPage() {
    const queryClient = useQueryClient()

    // Lista venditori con paginazione
    const {data, isLoading} = useQuery({
        queryKey: ['admin', 'sellers', {page: 1}],
        queryFn: async () => {
            const {data, error} = await api().admin.sellers.get({
                query: {page: 1, limit: 20},
            })
            if (error) throw new Error(error.value.message)
            return data
        },
    })

    // Mutation per verificare un venditore
    const verifyMutation = useMutation({
        mutationFn: async (sellerId: string) => {
            const {data, error} = await api().admin.sellers[sellerId]['verify'].post()
            if (error) throw new Error(error.value.message)
            return data
        },
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['admin', 'sellers']})
        },
    })

    if (isLoading) return <div>Caricamento...</div>

    return (
        <ul>
            {data?.data.map((seller) => (
                <li key={seller.id}>
                    {seller.vatNumber} — {seller.vatStatus}
                    {seller.vatStatus === 'pending' && (
                        <button onClick={() => verifyMutation.mutate(seller.id)}>
                            Verifica
                        </button>
                    )}
                </li>
            ))}
        </ul>
    )
}
```

### Gestione errori type-safe

Eden Treaty tipizza anche gli errori. Il pattern standard:

```typescript
const {data, error} = await api().admin.categories.post({
    name: 'Alimentari',
})

if (error) {
    // error.value è tipizzato: { success: false, error: string, message: string }
    switch (error.status) {
        case 400:
            console.error('Dati non validi:', error.value.message)
            break
        case 409:
            console.error('Categoria già esistente:', error.value.message)
            break
        case 401:
            // Redirect al login
            break
        default:
            console.error('Errore:', error.value.message)
    }
    return
}

// data è tipizzato automaticamente dal backend
console.log(`Categoria ${data.data.id} creata!`)
```

### Upload immagini

```typescript
const file = new File([blob], 'product.jpg', {type: 'image/jpeg'})

const {data, error} = await api()
    .seller.products({id: productId})
    .images.post({
        files: file,
        position: 0,
    })

if (error) {
    alert(error.value.message)
} else {
    console.log(`Caricate ${data.data.length} immagini`)
}
```

### Ricerca prodotti con parametri geo

```typescript
const {data} = await api().customer.search.get({
    query: {
        q: 'pizza',
        lat: 45.4642,
        lng: 9.19,
        radius: 10,
        page: 1,
        limit: 20,
    },
})
```

### Paginazione con React Query

Pattern riutilizzabile:

```typescript
function usePaginatedQuery<T>(
    baseKey: string[],
    fetchFn: (page: number) => Promise<{
        data: T[]
        pagination: { page: number; limit: number; total: number }
    }>,
    page: number,
) {
    return useQuery({
        queryKey: [...baseKey, {page}],
        queryFn: () => fetchFn(page),
        placeholderData: (prev) => prev,
    })
}

// Uso:
const [page, setPage] = useState(1)

const {data} = usePaginatedQuery(
    ['admin', 'categories'],
    async (p) => {
        const {data, error} = await api().admin.categories.get({
            query: {page: p, limit: 20},
        })
        if (error) throw new Error(error.value.message)
        return data
    },
    page,
)
```

## Autenticazione

Il backend usa **better-auth** con cookie HTTP-only. L'opzione `credentials: "include"` nel client Eden Treaty
garantisce che i cookie vengano inviati con ogni richiesta.

### Login (endpoint custom)

```typescript
const {data, error} = await api().register['sign-in'].post({
    email: 'admin@bibs.it',
    password: 'password',
})

if (data) {
    // data.user, data.profiles.customer, data.profiles.seller
}
```

### Logout (endpoint better-auth)

Gli endpoint better-auth (`/auth/api/*`) non sono tipizzati in Eden perché montati dinamicamente. Usare `fetch` diretto:

```typescript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

await fetch(`${API_URL}/auth/api/sign-out`, {
    method: 'POST',
    credentials: 'include',
})
```

### Utente corrente

```typescript
const {data: user, error} = await api().user.get()

if (error?.status === 401) {
    // Non autenticato → redirect al login
}
```

## CORS

Il backend accetta automaticamente `localhost` su qualsiasi porta in sviluppo. In produzione, configurare
`ALLOWED_ORIGINS` nel `.env` del backend:

```bash
ALLOWED_ORIGINS=https://admin.bibs.it,https://seller.bibs.it,https://bibs.it
```

## Vantaggi di Eden Treaty

1. **Type-safety end-to-end** — cambi il tipo sul backend e si aggiorna automaticamente sul frontend
2. **Auto-completion** — l'IDE suggerisce tutti gli endpoint con parametri e tipi di risposta
3. **Type narrowing** — errori tipizzati per status code: `if (error) { error.value.message }`
4. **Zero code generation** — tutto funziona con TypeScript inference
5. **< 2KB gzipped** — peso minimo nel bundle

## API Documentation

Tutti gli endpoint sono documentati su `http://localhost:3000/openapi` quando il server è in esecuzione (Scalar UI
interattiva).
