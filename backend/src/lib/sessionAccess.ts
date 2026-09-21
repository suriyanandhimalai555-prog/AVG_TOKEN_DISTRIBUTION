import { postgresPool } from "./postgres";

export async function assertSessionOwned(
  sessionId: string | undefined,
  userId: string
): Promise<boolean> {
  if (!sessionId || !postgresPool) {
    return false;
  }

  const result = await postgresPool.query(
    `
      SELECT 1
      FROM distribution_sessions
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [sessionId, userId]
  );

  return result.rowCount === 1;
}
