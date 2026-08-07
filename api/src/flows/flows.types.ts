export type FlowStatus = 'draft' | 'active' | 'paused';

export type FlowNodeKind =
  | 'message_text'
  | 'message_buttons'
  | 'message_image'
  | 'message_document'
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

export type FlowEventType =
  | 'entered'
  | 'replied'
  | 'timeout_sent'
  | 'timeout_closed'
  | 'completed'
  | 'handed_off';

export type FlowNodeDto = {
  id: number;
  client_key: string;
  kind: FlowNodeKind;
  body_text: string;
  buttons: FlowButton[];
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  timeout_minutes: number | null;
  timeout_body_text: string;
  timeout_repeat: boolean;
  timeout_max_nudges: number | null;
  timeout_close_on_silence: boolean;
  timeout_window_guard: boolean;
  timeout_window_lead_minutes: number | null;
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

export type FlowNodeAnalytics = {
  client_key: string;
  node_id: number | null;
  label: string;
  kind: string;
  entered: number;
  replied: number;
  waiting: number;
  deleted: boolean;
};

export type FlowAnalytics = {
  started: number;
  active: number;
  completed: number;
  handed_off: number;
  timeout_closed: number;
  nodes: FlowNodeAnalytics[];
};

export type FlowEventContactRow = {
  conversation_id: number;
  contact_id: number | null;
  contact_name: string;
  phone: string;
  event_type: string;
  client_key: string | null;
  node_label: string | null;
  match_payload: string | null;
  created_at: string;
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
  analytics: FlowAnalytics;
  created_at: string;
  updated_at: string;
};

export type FlowNodeInput = {
  client_key: string;
  kind: FlowNodeKind;
  body_text?: string;
  buttons?: FlowButton[];
  media_url?: string | null;
  media_mime?: string | null;
  media_filename?: string | null;
  timeout_minutes?: number | null;
  timeout_body_text?: string;
  timeout_repeat?: boolean;
  timeout_max_nudges?: number | null;
  timeout_close_on_silence?: boolean;
  timeout_window_guard?: boolean;
  timeout_window_lead_minutes?: number | null;
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
