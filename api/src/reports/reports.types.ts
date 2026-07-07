export type AuditLogListItem = {
  id: string;
  created_at: string;
  created_display: string;
  level: string;
  event_type: string;
  message: string;
  actor_user_id: number | null;
  actor_email: string | null;
  area: string | null;
  client_ip: string | null;
  request_id: string | null;
  phone: string | null;
  meta_summary: string;
};

export type AuditLogListResult = {
  rows: AuditLogListItem[];
  filters: {
    level: string;
    event: string;
    from: string;
    to: string;
  };
  pagination: {
    page: number;
    total_pages: number;
    total: number;
  };
  display_timezone: string;
  retention_days: number;
  area_scoped: boolean;
  area_label: string | null;
};

export type CommunicationReportResult = {
  rows: import('./contact-communication-report.util').ContactCommunicationRow[];
  pagination: {
    page: number;
    total_pages: number;
    total: number;
  };
  area_label: string;
};
