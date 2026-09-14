import { ParseIntPipe } from '@nestjs/common';

/**
 * The pipe for every `limit` / `offset` query parameter in this API.
 *
 * These arrive as strings and used to be `parseInt`-ed inline in each handler.
 * `parseInt('abc')` is `NaN`, `Math.min(NaN, 200)` is `NaN`, and `qb.take(NaN)`
 * reaches Postgres as an invalid LIMIT — so `?limit=abc` answered **500** on
 * five endpoints (`/documents`, `/audit-logs`, `/chat/history`,
 * `/chat/answers`, and `/documents?offset=`), and wrote an `ERROR:UNHANDLED`
 * audit row on the way out. Verified by probing a running instance before this
 * was changed; `test/pagination.e2e-spec.ts` now pins the corrected behaviour.
 *
 * A malformed query string is a client error, so it is a 400 from the pipe
 * before the handler runs. `optional: true` is what keeps an *absent*
 * parameter absent rather than turning it into 0 — every service supplies its
 * own default (`audit.service.ts:57`, `documents.service.ts:188`), and a
 * silent 0 would mean "no rows" where the caller asked for "the default page".
 *
 * Shared rather than per-controller so the three call sites cannot drift into
 * three different answers for the same malformed input.
 */
export const PAGE_INT = new ParseIntPipe({ optional: true });
