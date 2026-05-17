-- Drop legacy signee_name if it exists (safe no-op if already gone)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agreements' AND column_name = 'signee_name'
  ) THEN
    ALTER TABLE agreements DROP COLUMN signee_name;
  END IF;
END $$;
