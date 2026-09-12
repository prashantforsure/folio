-- 0007 - the balance view, corrected. Found by the first reservation.
--
-- `credit_balances` (0001, section 9) summed *every* entry into `settled` and
-- then added the held reservations to get `available`. A held reservation is
-- a negative entry, so it was subtracted twice: a grant of 8 with one 4-credit
-- job queued read as 0 available, not 4. Nothing had written a `reserve`
-- before the Storyboard route, so the arithmetic had never run against a real
-- row. `repositories/credits.ts` mirrors the view and is corrected with it.
--
-- The model the kinds were designed around, now stated by the view:
--
--   reserve / release   the provisional pair. A reservation is opened before
--                       a job is enqueued and *closed* by a `spend` (the work
--                       ran) or a `release` (it did not). Neither is a real
--                       charge and neither is in `settled`.
--   grant purchase      the real movements, and the whole of `settled`.
--   spend refund
--   expire adjust
--   available           `settled` less what is still held.
--
-- A failed job that consumed the work is a `spend` closing its reservation
-- plus a `refund` giving it back; a job cancelled before it ran is a
-- `release`. Both leave `available` where it should be.
--
-- CREATE OR REPLACE, same columns, same `security_invoker`; the grant from
-- 0001 survives. Nothing here touches a row: the ledger is append-only and
-- this is a read. Forward-only, as every migration is.

CREATE OR REPLACE VIEW public.credit_balances
WITH (security_invoker = true)
AS
  SELECT
    l.project_id,
    coalesce(sum(l.delta) FILTER (
      WHERE l.kind NOT IN ('reserve', 'release')
    ), 0)::int AS settled,
    coalesce(sum(l.delta) FILTER (
      WHERE l.kind = 'reserve'
        AND NOT EXISTS (
          SELECT 1 FROM public.credit_ledger closing
          WHERE closing.project_id = l.project_id
            AND closing.job_id IS NOT DISTINCT FROM l.job_id
            AND closing.kind IN ('release', 'spend')
        )
    ), 0)::int AS reserved,
    (
      coalesce(sum(l.delta) FILTER (
        WHERE l.kind NOT IN ('reserve', 'release')
      ), 0)
      + coalesce(sum(l.delta) FILTER (
          WHERE l.kind = 'reserve'
            AND NOT EXISTS (
              SELECT 1 FROM public.credit_ledger closing
              WHERE closing.project_id = l.project_id
                AND closing.job_id IS NOT DISTINCT FROM l.job_id
                AND closing.kind IN ('release', 'spend')
            )
        ), 0)
    )::int AS available
  FROM public.credit_ledger l
  GROUP BY l.project_id;
