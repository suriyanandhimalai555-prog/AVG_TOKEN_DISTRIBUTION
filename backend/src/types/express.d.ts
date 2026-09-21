declare global {
  namespace Express {
    interface User {
      _id: string;
      googleId?: string;
      email: string;
      name: string;
      avatar?: string;
      role: "USER" | "ADMIN";
    }
  }
}

export {};
