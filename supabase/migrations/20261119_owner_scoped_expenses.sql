ALTER TABLE public."expenseTrack"
	ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."expenseTrack"
	ALTER COLUMN user_id SET DEFAULT auth.uid(),
	ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS "expenseTrack_user_id_idx"
	ON public."expenseTrack" (user_id);

ALTER TABLE public."expenseTrack" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
	policy_record record;
BEGIN
	FOR policy_record IN
		SELECT policyname
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'expenseTrack'
			AND (
				roles @> ARRAY['anon'::name]
				OR roles @> ARRAY['public'::name]
			)
	LOOP
		EXECUTE format(
			'DROP POLICY %I ON public."expenseTrack"',
			policy_record.policyname
		);
	END LOOP;
END;
$$;

DROP POLICY IF EXISTS "expense_owner_select" ON public."expenseTrack";
DROP POLICY IF EXISTS "expense_owner_insert" ON public."expenseTrack";
DROP POLICY IF EXISTS "expense_owner_update" ON public."expenseTrack";
DROP POLICY IF EXISTS "expense_owner_delete" ON public."expenseTrack";

CREATE POLICY "expense_owner_select"
	ON public."expenseTrack"
	FOR SELECT TO authenticated
	USING (auth.uid() = user_id);

CREATE POLICY "expense_owner_insert"
	ON public."expenseTrack"
	FOR INSERT TO authenticated
	WITH CHECK (auth.uid() = user_id);

CREATE POLICY "expense_owner_update"
	ON public."expenseTrack"
	FOR UPDATE TO authenticated
	USING (auth.uid() = user_id)
	WITH CHECK (auth.uid() = user_id);

CREATE POLICY "expense_owner_delete"
	ON public."expenseTrack"
	FOR DELETE TO authenticated
	USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public."expenseTrack" FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."expenseTrack" TO authenticated;

DO $$
DECLARE
	sequence_name text;
BEGIN
	sequence_name := pg_get_serial_sequence('public."expenseTrack"', 'id');
	IF sequence_name IS NOT NULL THEN
		EXECUTE format(
			'GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated',
			sequence_name
		);
	END IF;
END;
$$;
