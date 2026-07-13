export type AdminUserPermissions = {
  can_edit_ai_prompt: boolean;
  can_view_audit_logs: boolean;
  can_view_integration: boolean;
  can_edit_business_hours: boolean;
  can_view_reports: boolean;
  can_assign_conversations: boolean;
  can_manage_attributes: boolean;
  can_manage_segments: boolean;
  can_view_conversation_stats: boolean;
  can_view_campaign_stats: boolean;
};

export type AdminUserListItem = {
  id: number;
  email: string;
  area: string;
  is_master: boolean;
  must_change_password: boolean;
  created_at: string;
} & AdminUserPermissions;

export type AdminUserDetail = AdminUserListItem & {
  extra_areas: string[];
};

export type AdminOnlineUser = {
  email: string;
};

export type AdminOnlineUsersResult = {
  users: AdminOnlineUser[];
  idle_minutes: number;
};

export type AdminMetaSettingsView = {
  global: { verify_token: string; app_secret: string };
  areas: Record<
    string,
    { whatsapp_token: string; phone_number_id: string; waba_id: string }
  >;
};
