import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("[PostgreSQL] DATABASE_URL is not set");
}

export const postgresPool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: {
        rejectUnauthorized: false,
      },
    })
  : null;

export async function syncUserToPostgres(user: {
  _id: { toString(): string };
  googleId?: string;
  email: string;
  name: string;
  avatar?: string;
  passwordHash?: string;
  passwordSalt?: string;
  role: "USER" | "ADMIN";
}): Promise<void> {
  if (!postgresPool) {
    console.warn(
      "[PostgreSQL] DATABASE_URL is not configured — user sync skipped"
    );
    return;
  }

  try {
    const userId = user._id.toString();
    const now = new Date();

    await postgresPool.query(
      `
        INSERT INTO users (
          id,
          google_id,
          email,
          name,
          avatar,
          password_hash,
          password_salt,
          role,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
        )
        ON CONFLICT (id)
        DO UPDATE SET
          google_id = EXCLUDED.google_id,
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          avatar = EXCLUDED.avatar,
          password_hash = EXCLUDED.password_hash,
          password_salt = EXCLUDED.password_salt,
          role = EXCLUDED.role,
          updated_at = EXCLUDED.updated_at
      `,
      [
        userId,
        user.googleId ?? null,
        user.email,
        user.name,
        user.avatar ?? null,
        user.passwordHash ?? null,
        user.passwordSalt ?? null,
        user.role,
        now,
      ]
    );

    console.log(`[PostgreSQL] User synchronized: ${userId}`);
  } catch (err) {
    console.error("[PostgreSQL] User sync failed:", err);
  }
}
