# Third-party notices

Until the Hono migration (U11, 2026-10) the API ran on Elysia. To keep its HTTP
behaviour identical, a few rules and snippets of these MIT-licensed packages were
ported into `apps/api/src` (the packages themselves are no longer dependencies):

| Package | Version | Copyright | Ported into |
|---|---|---|---|
| elysia | 1.4.30 | Copyright 2022 saltyAom | `src/http/validator.ts` (body, multipart, urlencoded and query parsing), `src/http/app.ts` (raw path), `src/lib/schemas/t.ts` (integer, date and file checks, response encoding), `src/lib/schemas/formats.ts` (`date-time`, numeric/integer/boolean strings), `src/lib/schemas/mirror.ts` (`hasProperty`, `hasType`, root defaults) |
| @elysiajs/openapi | 1.4.16 | Copyright 2022 saltyAom | `src/http/openapi.ts` (operation ids, enum and nullable transforms), `src/http/openapi-page.ts` (Scalar page and CSS) |
| @elysiajs/cors | 1.4.2 | Copyright 2022 saltyAom | `src/plugins/cors.ts` (response and preflight headers) |
| exact-mirror | 0.2.7 | Copyright 2022 saltyAom | `src/lib/schemas/mirror.ts` (clean-up of the validated value) |
| logixlysia | 6.10.3 | Copyright (c) 2023 PunGrumpy | `src/plugins/request-log.ts` (request line format and colours) |
| ajv-formats | via elysia | Copyright (c) 2020 Evgeny Poberezkin | `src/lib/schemas/formats.ts` (`uri`, `date-time` regexes) |
| zod | 4.4.3, via @elysiajs/openapi | Copyright (c) 2025 Colin McDonnell | `src/lib/schemas/formats.ts` (`email`, `uuid`, `date` regexes) |

All of them are released under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in
> the Software without restriction, including without limitation the rights to
> use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
> the Software, and to permit persons to whom the Software is furnished to do so,
> subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
> FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
> AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
> WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
