import type { AiConfig } from './ai-config.util';
import type { BusinessHoursConfig } from './business-hours.util';

export type SettingsModuleItem = {
  id: string;
  path: string;
  title: string;
  preview: string;
  navGroup: 'ajustes' | 'reportes';
};

export type IntegrationSettings = {
  app_base_url: string;
  webhook_url: string;
  health_url: string;
  dashboard_api_url: string;
};

export type AiSettingsView = AiConfig & {
  area: string;
  can_toggle_enabled: boolean;
};

export type BusinessHoursSettingsView = Omit<
  BusinessHoursConfig,
  'fromMinutes' | 'toMinutes'
> & {
  area: string;
};

export type EducationSlaSettingsView = {
  target_minutes: number;
  timezone: string;
  days: { day: number; from: string; to: string }[];
  alerts_since: string | null;
  min_target_minutes: number;
  max_target_minutes: number;
};
