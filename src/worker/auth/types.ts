export type AuthAdminMode = "access" | "dual" | "passkey";
export type AuthActivatorMode = "legacy" | "dual" | "unified";
export type AuthSessionPurpose = "authenticated" | "enrollment" | "recovery";
export type AuthMethod =
  | "passkey"
  | "email"
  | "legacy-link"
  | "legacy-session"
  | "access-bootstrap";

export type AuthUser = {
  id: string;
  webauthnUserId: string;
  displayName: string;
  primaryEmail: string | null;
  disabledAt: string | null;
};

export type AuthSession = {
  id: string;
  userId: string;
  purpose: AuthSessionPurpose;
  authenticationMethod: AuthMethod;
  authenticatedAt: string;
  passkeyVerifiedAt: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

export type AuthContext = {
  user: AuthUser;
  session: AuthSession;
  admin: boolean;
  activator: null | {
    activatorId: string;
    eventId: string;
    callsign: string;
    name: string;
    status: "pending" | "approved" | "rejected" | "withdrawn";
  };
};
