export interface AuthUser {
  _id: string;
  googleId?: string;
  email: string;
  name: string;
  avatar?: string;
  role: "USER" | "ADMIN";
}

export interface AuthSubscription {
  _id: string;
  userId?: string;
  productLine: "TOKEN_HOLDER" | "DEX_AUTOMATION";
  planKey: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING";
  walletLimit: number;
  startedAt?: string;
  expiresAt?: string;
}
