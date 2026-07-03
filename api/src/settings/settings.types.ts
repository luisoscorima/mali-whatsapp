import type { AiConfig } from './ai-config.util';
import type { BusinessHoursConfig } from './business-hours.util';

export type SettingsModuleItem = {
  id: string;
  path: string;
  title: string;
  preview: string;
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
