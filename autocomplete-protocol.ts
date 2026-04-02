import type { EventBus } from "@mariozechner/pi-coding-agent";

import type {
  PowerlineAutocompleteEnhancer,
  PowerlineAutocompleteInactiveReason,
} from "./types.js";

export const POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION = 2 as const;

export const POWERLINE_AUTOCOMPLETE_EVENTS = {
  ready: "powerline:autocomplete:ready",
  state: {
    active: "powerline:autocomplete:state:active",
    inactive: "powerline:autocomplete:state:inactive",
  },
  ui: {
    refresh: "powerline:autocomplete:ui:refresh",
  },
  rpc: {
    register: "powerline:autocomplete:rpc:register",
    unregister: "powerline:autocomplete:rpc:unregister",
  },
} as const;

export interface PowerlineAutocompleteExtensionIdentity {
  id: string;
  version?: string;
}

export interface PowerlineAutocompleteRegisterRequest {
  requestId: string;
  protocolVersion: number;
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancer: PowerlineAutocompleteEnhancer;
}

export interface PowerlineAutocompleteUnregisterRequest {
  requestId: string;
  protocolVersion: number;
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancerId: string;
  registrationId: string;
}

export interface PowerlineAutocompleteReadyData {
  version: number;
}

export interface PowerlineAutocompleteRegisterReplyData {
  installedId: string;
  registrationId: string;
  active: boolean;
}

export interface PowerlineAutocompleteRegistration {
  enhancerId: string;
  installedId: string;
  registrationId: string;
  active: boolean;
}

export interface PowerlineAutocompleteActiveStateData {
  installedId: string;
  extensionId: string;
  enhancerId: string;
}

export interface PowerlineAutocompleteInactiveStateData
  extends PowerlineAutocompleteActiveStateData {
  reason: PowerlineAutocompleteInactiveReason;
}

export interface PowerlineAutocompleteRefreshRequest<TData = unknown> {
  installedId: string;
  data?: TData;
}

export type PowerlineAutocompleteRpcReply<TData = void> =
  | { success: true; data?: TData }
  | { success: false; error: string };

export interface PowerlineAutocompleteBridgeDebugEvent {
  type:
    | "ready:emit"
    | "ready:receive"
    | "rpc:register:emit"
    | "rpc:register:reply"
    | "rpc:register:timeout"
    | "rpc:register:handle"
    | "rpc:unregister:emit"
    | "rpc:unregister:reply"
    | "rpc:unregister:timeout"
    | "rpc:unregister:handle";
  channel?: string;
  requestId?: string;
  data?: unknown;
}

export function createReplyChannel(channel: string, requestId: string): string {
  return `${channel}:reply:${requestId}`;
}

export function validateProtocolVersion(protocolVersion: number): void {
  if (protocolVersion !== POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported autocomplete protocol version ${protocolVersion}.`);
  }
}

export function replyToRpc<TData = void>(
  events: EventBus,
  channel: string,
  requestId: string,
  handler: () => TData,
): void {
  const replyChannel = createReplyChannel(channel, requestId);
  try {
    const data = handler();
    const reply: PowerlineAutocompleteRpcReply<TData> = { success: true, data };
    events.emit(replyChannel, reply);
  } catch (error) {
    const reply: PowerlineAutocompleteRpcReply = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    events.emit(replyChannel, reply);
  }
}
