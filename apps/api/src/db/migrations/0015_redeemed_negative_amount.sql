-- Custom SQL migration file, put your code below! --
-- redeemed si scrive con amount negativo, così Σ amount = customer_profiles.points.
-- Le righe storiche avevano il segno positivo: si ribaltano qui. Il vecchio CHECK
-- (amount > 0) va tolto prima, e il CHECK di segno per tipo lo aggiunge la
-- migrazione successiva (generata dallo schema). Idempotente: IF EXISTS e il
-- filtro amount > 0 rendono una seconda esecuzione un no-op.
ALTER TABLE "point_transactions" DROP CONSTRAINT IF EXISTS "point_transaction_amount_positive";--> statement-breakpoint
UPDATE "point_transactions" SET "amount" = -"amount" WHERE "type" = 'redeemed' AND "amount" > 0;
