export type FlowStatus = 'draft' | 'active' | 'paused';

export type FlowNodeKind =
  | 'message_text'
  | 'message_buttons'
  | 'handoff_human'
  | 'end';

export type FlowButton = {
  id: string;
  title: string;
};

export const FLOW_TIMEOUT_CONTINUE = 'FLOW_CONTINUE';
export const FLOW_TIMEOUT_STOP = 'FLOW_STOP';

export const DEFAULT_FLOW_TIMEOUT_BODY =
  '¿Sigues ahí? Pulsa Continuar para seguir con el flujo.';

export type FlowNodeDto = {
  id: number;
  kind: FlowNodeKind;
  body_text: string;
  buttons: FlowButton[];
  timeout_minutes: number | null;
  timeout_body_text: string;
  sort_order: number;
  position_x: number;
  position_y: number;
  handoff_user_id: number | null;
};

export type FlowEdgeDto = {
  id: number;
  from_node_id: number;
  to_node_id: number;
  match_payload: string | null;
};

export type FlowListItem = {
  id: number;
  name: string;
  status: FlowStatus;
  trigger_payload: string;
  entry_node_id: number | null;
  node_count: number;
  active_sessions: number;
  completed_sessions: number;
  handed_off_sessions: number;
  created_at: string;
  updated_at: string;
};

export type FlowDetail = {
  id: number;
  name: string;
  status: FlowStatus;
  trigger_payload: string;
  entry_node_id: number | null;
  nodes: FlowNodeDto[];
  edges: FlowEdgeDto[];
  metrics: {
    active_sessions: number;
    completed_sessions: number;
    handed_off_sessions: number;
  };
  created_at: string;
  updated_at: string;
};

export type FlowNodeInput = {
  client_key: string;
  kind: FlowNodeKind;
  body_text?: string;
  buttons?: FlowButton[];
  timeout_minutes?: number | null;
  timeout_body_text?: string;
  sort_order?: number;
  position_x?: number;
  position_y?: number;
  handoff_user_id?: number | null;
};

export type FlowEdgeInput = {
  from_client_key: string;
  to_client_key: string;
  match_payload?: string | null;
};
