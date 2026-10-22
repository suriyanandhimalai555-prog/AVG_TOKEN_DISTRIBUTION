-- Session audit history outlives the session it describes.
--
-- DELETE /api/sessions/:id removes the session, then records SESSION_DELETED
-- with that session id, so session_audits.session_id must not be a foreign key
-- to distribution_sessions (0000_baseline.sql has none). Some databases have
-- one anyway (session_audits_session_id_fkey), which made every delete of a
-- session with history fail with 23503. Drop any such key; rows are untouched.
-- Idempotent: safe to run more than once.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.conrelid = 'session_audits'::regclass
      AND con.confrelid = 'distribution_sessions'::regclass
  LOOP
    EXECUTE format('ALTER TABLE session_audits DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
