const SETTINGS_MODULES = [
  {
    id: 'integracion',
    path: '/settings/integracion',
    title: 'Integración',
    preview: 'Webhook, API y documentación',
    userFlag: 'canViewIntegration',
  },
  {
    id: 'ia',
    path: '/settings/ia',
    title: 'Respuesta automática (IA)',
    preview: 'Prompt y palabra de transferencia',
    userFlag: 'canEditAiPrompt',
  },
  {
    id: 'fuera-de-horario',
    path: '/settings/fuera-de-horario',
    title: 'Fuera de horario',
    preview: 'Horario y mensaje automático',
    userFlag: 'canEditBusinessHours',
  },
  {
    id: 'bitacora',
    path: '/settings/bitacora',
    title: 'Bitácora',
    preview: 'Auditoría de su área',
    userFlag: 'canViewAuditLogs',
  },
  {
    id: 'reporteria',
    path: '/settings/reporteria',
    title: 'Reportería',
    preview: 'Comunicaciones por contacto',
    userFlag: 'canViewReports',
  },
];

function userCanAccessSettingsModule(user, moduleId) {
  if (!user) return false;
  if (user.isMaster) return true;
  const mod = SETTINGS_MODULES.find((m) => m.id === moduleId);
  if (!mod) return false;
  return Boolean(user[mod.userFlag]);
}

function visibleSettingsModules(user) {
  if (!user) return [];
  return SETTINGS_MODULES.filter((m) => userCanAccessSettingsModule(user, m.id));
}

function firstSettingsModulePath(user) {
  const mods = visibleSettingsModules(user);
  return mods.length > 0 ? mods[0].path : null;
}

module.exports = {
  SETTINGS_MODULES,
  userCanAccessSettingsModule,
  visibleSettingsModules,
  firstSettingsModulePath,
};
