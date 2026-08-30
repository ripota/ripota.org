export type OpsRoomMode = "full" | "announcements" | "off";
export type OpsMembershipStatus = "active" | "muted" | "banned";
export type OpsMessageKind =
  | "chat"
  | "access-note"
  | "running-late"
  | "need-backup"
  | "announcement"
  | "system";

export type OpsActor =
  | {
      type: "activator";
      activatorId: string;
      label: string;
    }
  | {
      type: "admin";
      key: string;
      label: string;
    };

export type OpsMessageContext =
  | null
  | { type: "park"; parkReference: string }
  | { type: "stop"; stopId: string };

export type OpsMessageDto = {
  id: string;
  kind: OpsMessageKind;
  authorType: "activator" | "admin" | "system";
  authorLabel: string;
  authorActivatorId?: string;
  body: string;
  parkReference?: string;
  stopId?: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  removed: boolean;
  removedAt?: string;
  removedBy?: "author" | "organizer";
};

export type OpsEvent =
  | { sequence: number; type: "message-created"; message: OpsMessageDto }
  | {
      sequence: number;
      type: "message-removed";
      messageId: string;
      removedAt: string;
      removedBy: "author" | "organizer";
    }
  | {
      sequence: number;
      type: "message-resolved" | "message-reopened";
      messageId: string;
      resolvedAt?: string;
    }
  | {
      sequence: number;
      type: "pin-changed";
      pinnedMessage: OpsMessageDto | null;
    }
  | {
      sequence: number;
      type: "room-mode-changed";
      mode: OpsRoomMode;
    };

export type OpsUpcomingStopDto = {
  id: string;
  parkReference: string;
  startAt: string;
  endAt: string;
};

export type OpsBootstrapDto = {
  membership: {
    status: OpsMembershipStatus;
    acceptedRulesVersion?: string;
    acceptedRulesAt?: string;
  };
  rulesVersion: string;
  roomMode: OpsRoomMode;
  pinnedMessage: OpsMessageDto | null;
  messages: OpsMessageDto[];
  upcomingStops: OpsUpcomingStopDto[];
  cursor: number;
};

export type CreateOpsMessageInput = {
  clientNonce: string;
  kind: OpsMessageKind;
  body: string;
  context: OpsMessageContext;
};
