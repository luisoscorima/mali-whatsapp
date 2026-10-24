import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WaAppShell } from './WaAppShell'
import { RequireAuth } from './RequireAuth'
import { RequirePasswordChanged } from './RequirePasswordChanged'
import { RequireUserPermission, HomeRedirect } from './appOutletContext'
import { PERMISSION, userHasPermission } from '@/shared/auth/permissions'
const LoginPage = lazy(() =>
  import('../features/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const ChangePasswordPage = lazy(() =>
  import('../features/auth/ChangePasswordPage').then((m) => ({
    default: m.ChangePasswordPage,
  })),
)
const MetaAdsShell = lazy(() =>
  import('../features/meta-ads/MetaAdsShell').then((m) => ({
    default: m.MetaAdsShell,
  })),
)
const MetaAdsEmptyPane = lazy(() =>
  import('../features/meta-ads/MetaAdsEmptyPane').then((m) => ({
    default: m.MetaAdsEmptyPane,
  })),
)
const MetaAdDetailPage = lazy(() =>
  import('../features/meta-ads/MetaAdDetailPage').then((m) => ({
    default: m.MetaAdDetailPage,
  })),
)
const LeadsHubPage = lazy(() =>
  import('../features/leads/LeadsHubPage').then((m) => ({
    default: m.LeadsHubPage,
  })),
)
const MetaFormsPage = lazy(() =>
  import('../features/leads/MetaFormsPage').then((m) => ({
    default: m.MetaFormsPage,
  })),
)
const TikTokFormsPage = lazy(() =>
  import('../features/leads/TikTokFormsPage').then((m) => ({
    default: m.TikTokFormsPage,
  })),
)
const LeadsShell = lazy(() =>
  import('../features/leads/LeadsShell').then((m) => ({
    default: m.LeadsShell,
  })),
)
const AttributesShell = lazy(() =>
  import('../features/attributes/AttributesShell').then((m) => ({
    default: m.AttributesShell,
  })),
)
const AttributesSummaryPane = lazy(() =>
  import('../features/attributes/AttributesSummaryPane').then((m) => ({
    default: m.AttributesSummaryPane,
  })),
)
const AttributeNewPage = lazy(() =>
  import('../features/attributes/AttributeNewPage').then((m) => ({
    default: m.AttributeNewPage,
  })),
)
const AttributeDetailPage = lazy(() =>
  import('../features/attributes/AttributeDetailPage').then((m) => ({
    default: m.AttributeDetailPage,
  })),
)
const SegmentsShell = lazy(() =>
  import('../features/segments/SegmentsShell').then((m) => ({
    default: m.SegmentsShell,
  })),
)
const SegmentsSummaryPane = lazy(() =>
  import('../features/segments/SegmentsSummaryPane').then((m) => ({
    default: m.SegmentsSummaryPane,
  })),
)
const SegmentNewPage = lazy(() =>
  import('../features/segments/SegmentNewPage').then((m) => ({
    default: m.SegmentNewPage,
  })),
)
const SegmentDetailPage = lazy(() =>
  import('../features/segments/SegmentDetailPage').then((m) => ({
    default: m.SegmentDetailPage,
  })),
)
const ContactsShell = lazy(() =>
  import('../features/contacts/ContactsShell').then((m) => ({
    default: m.ContactsShell,
  })),
)
const ContactsSummaryPane = lazy(() =>
  import('../features/contacts/ContactsSummaryPane').then((m) => ({
    default: m.ContactsSummaryPane,
  })),
)
const ContactImportPage = lazy(() =>
  import('../features/contacts/ContactImportPage').then((m) => ({
    default: m.ContactImportPage,
  })),
)
const ContactNewPage = lazy(() =>
  import('../features/contacts/ContactNewPage').then((m) => ({
    default: m.ContactNewPage,
  })),
)
const ContactDetailPage = lazy(() =>
  import('../features/contacts/ContactDetailPage').then((m) => ({
    default: m.ContactDetailPage,
  })),
)
const TemplatesShell = lazy(() =>
  import('../features/templates/TemplatesShell').then((m) => ({
    default: m.TemplatesShell,
  })),
)
const TemplatesSummaryPane = lazy(() =>
  import('../features/templates/TemplatesSummaryPane').then((m) => ({
    default: m.TemplatesSummaryPane,
  })),
)
const TemplateDetailPage = lazy(() =>
  import('../features/templates/TemplateDetailPage').then((m) => ({
    default: m.TemplateDetailPage,
  })),
)
const TemplateNewPage = lazy(() =>
  import('../features/templates/TemplateNewPage').then((m) => ({
    default: m.TemplateNewPage,
  })),
)
const CampaignsShell = lazy(() =>
  import('../features/campaigns/CampaignsShell').then((m) => ({
    default: m.CampaignsShell,
  })),
)
const CampaignsSummaryPane = lazy(() =>
  import('../features/campaigns/CampaignsSummaryPane').then((m) => ({
    default: m.CampaignsSummaryPane,
  })),
)
const CampaignNewPage = lazy(() =>
  import('../features/campaigns/CampaignNewPage').then((m) => ({
    default: m.CampaignNewPage,
  })),
)
const CampaignDetailPage = lazy(() =>
  import('../features/campaigns/CampaignDetailPage').then((m) => ({
    default: m.CampaignDetailPage,
  })),
)
const FlowsShell = lazy(() =>
  import('../features/flows/FlowsShell').then((m) => ({
    default: m.FlowsShell,
  })),
)
const FlowsSummaryPane = lazy(() =>
  import('../features/flows/FlowsSummaryPane').then((m) => ({
    default: m.FlowsSummaryPane,
  })),
)
const FlowNewPage = lazy(() =>
  import('../features/flows/FlowNewPage').then((m) => ({
    default: m.FlowNewPage,
  })),
)
const FlowDetailPage = lazy(() =>
  import('../features/flows/FlowDetailPage').then((m) => ({
    default: m.FlowDetailPage,
  })),
)
const SettingsShell = lazy(() =>
  import('../features/settings/SettingsShell').then((m) => ({
    default: m.SettingsShell,
  })),
)
const SettingsIndexPage = lazy(() =>
  import('../features/settings/SettingsIndexPage').then((m) => ({
    default: m.SettingsIndexPage,
  })),
)
const SettingsIntegrationPage = lazy(() =>
  import('../features/settings/SettingsIntegrationPage').then((m) => ({
    default: m.SettingsIntegrationPage,
  })),
)
const SettingsAiPage = lazy(() =>
  import('../features/settings/SettingsAiPage').then((m) => ({
    default: m.SettingsAiPage,
  })),
)
const SettingsBusinessHoursPage = lazy(() =>
  import('../features/settings/SettingsBusinessHoursPage').then((m) => ({
    default: m.SettingsBusinessHoursPage,
  })),
)
const SettingsAuditPage = lazy(() =>
  import('../features/settings/SettingsAuditPage').then((m) => ({
    default: m.SettingsAuditPage,
  })),
)
const SettingsReporteriaPage = lazy(() =>
  import('../features/settings/SettingsReporteriaPage').then((m) => ({
    default: m.SettingsReporteriaPage,
  })),
)
const ConversationsInboxPage = lazy(() =>
  import('../features/conversations/ConversationsInboxPage').then((m) => ({
    default: m.ConversationsInboxPage,
  })),
)
const RequireMaster = lazy(() =>
  import('../features/admin/AdminShell').then((m) => ({
    default: m.RequireMaster,
  })),
)
const AdminShell = lazy(() =>
  import('../features/admin/AdminShell').then((m) => ({
    default: m.AdminShell,
  })),
)
const AdminUsersShell = lazy(() =>
  import('../features/admin/AdminUsersShell').then((m) => ({
    default: m.AdminUsersShell,
  })),
)
const AdminIndexPage = lazy(() =>
  import('../features/admin/AdminIndexPage').then((m) => ({
    default: m.AdminIndexPage,
  })),
)
const AdminMetaPage = lazy(() =>
  import('../features/admin/AdminMetaPage').then((m) => ({
    default: m.AdminMetaPage,
  })),
)
const AdminAuditPage = lazy(() =>
  import('../features/admin/AdminAuditPage').then((m) => ({
    default: m.AdminAuditPage,
  })),
)
const AdminAreasPage = lazy(() =>
  import('../features/admin/AdminAreasPage').then((m) => ({
    default: m.AdminAreasPage,
  })),
)
const AdminWhatsappPage = lazy(() =>
  import('../features/admin/AdminWhatsappPage').then((m) => ({
    default: m.AdminWhatsappPage,
  })),
)
const AdminRolesPage = lazy(() =>
  import('../features/admin/AdminRolesPage').then((m) => ({
    default: m.AdminRolesPage,
  })),
)

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div role="status" className="p-4 text-muted">Cargando…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="account/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequirePasswordChanged />}>
            <Route element={<WaAppShell />}>
            <Route index element={<HomeRedirect />} />
            <Route
              path="leads"
              element={
                <RequireUserPermission
                  allowed={(u) => userHasPermission(u, PERMISSION.LEADS_LIST)}
                >
                  <LeadsShell />
                </RequireUserPermission>
              }
            >
              <Route index element={<LeadsHubPage />} />
              <Route path="meta-forms" element={<MetaFormsPage />} />
              <Route path="tiktok-forms" element={<TikTokFormsPage />} />
              <Route path="meta-ctwa" element={<MetaAdsShell />}>
                <Route index element={<MetaAdsEmptyPane />} />
                <Route path=":id" element={<MetaAdDetailPage />} />
              </Route>
            </Route>
            <Route
              path="attributes"
              element={
                <RequireUserPermission
                  allowed={(u) =>
                    userHasPermission(u, PERMISSION.ATTRIBUTES_LIST) ||
                    userHasPermission(u, PERMISSION.ATTRIBUTES_MANAGE)
                  }
                >
                  <AttributesShell />
                </RequireUserPermission>
              }
            >
              <Route index element={<AttributesSummaryPane />} />
              <Route path="new" element={<AttributeNewPage />} />
              <Route path=":id" element={<AttributeDetailPage />} />
            </Route>
            <Route
              path="segments"
              element={
                <RequireUserPermission
                  allowed={(u) =>
                    userHasPermission(u, PERMISSION.SEGMENTS_LIST) ||
                    userHasPermission(u, PERMISSION.SEGMENTS_MANAGE)
                  }
                >
                  <SegmentsShell />
                </RequireUserPermission>
              }
            >
              <Route index element={<SegmentsSummaryPane />} />
              <Route path="new" element={<SegmentNewPage />} />
              <Route path=":id" element={<SegmentDetailPage />} />
            </Route>
            <Route
              path="contacts"
              element={
                <RequireUserPermission
                  allowed={(u) =>
                    userHasPermission(u, PERMISSION.CONTACTS_MANAGE)
                  }
                >
                  <ContactsShell />
                </RequireUserPermission>
              }
            >
              <Route index element={<ContactsSummaryPane />} />
              <Route path="import" element={<ContactImportPage />} />
              <Route path="new" element={<ContactNewPage />} />
              <Route path=":id" element={<ContactDetailPage />} />
            </Route>
            <Route
              path="templates"
              element={
                <RequireUserPermission
                  allowed={(u) =>
                    userHasPermission(u, PERMISSION.TEMPLATES_LIST)
                  }
                >
                  <TemplatesShell />
                </RequireUserPermission>
              }
            >
              <Route index element={<TemplatesSummaryPane />} />
              <Route path="new" element={<TemplateNewPage />} />
              <Route path=":id" element={<TemplateDetailPage />} />
            </Route>
            <Route
              path="campaigns"
              element={
                <RequireUserPermission
                  allowed={(u) =>
                    userHasPermission(u, PERMISSION.CAMPAIGNS_LIST)
                  }
                >
                  <CampaignsShell />
                </RequireUserPermission>
              }
            >
              <Route index element={<CampaignsSummaryPane />} />
              <Route path="new" element={<CampaignNewPage />} />
              <Route path=":id" element={<CampaignDetailPage />} />
            </Route>
            <Route
              path="flows"
              element={
                <RequireUserPermission
                  allowed={(u) => userHasPermission(u, PERMISSION.FLOWS_LIST)}
                >
                  <FlowsShell />
                </RequireUserPermission>
              }
            >
              <Route index element={<FlowsSummaryPane />} />
              <Route path="new" element={<FlowNewPage />} />
              <Route path=":id" element={<FlowDetailPage />} />
            </Route>
            <Route
              path="conversations"
              element={
                <RequireUserPermission
                  allowed={(u) =>
                    userHasPermission(u, PERMISSION.CONVERSATIONS_MANAGE)
                  }
                >
                  <ConversationsInboxPage />
                </RequireUserPermission>
              }
            />
            <Route
              path="conversations/:id"
              element={
                <RequireUserPermission
                  allowed={(u) =>
                    userHasPermission(u, PERMISSION.CONVERSATIONS_MANAGE)
                  }
                >
                  <ConversationsInboxPage />
                </RequireUserPermission>
              }
            />
            <Route element={<RequireMaster />}>
              <Route path="admin" element={<AdminShell />}>
                <Route index element={<AdminIndexPage />} />
                <Route path="users" element={<AdminUsersShell />} />
                <Route path="users/new" element={<Navigate to="/admin/users" replace />} />
                <Route path="users/:id" element={<Navigate to="/admin/users" replace />} />
                <Route path="roles" element={<AdminRolesPage />} />
                <Route path="areas" element={<AdminAreasPage />} />
                <Route path="meta" element={<AdminMetaPage />} />
                <Route path="whatsapp" element={<AdminWhatsappPage />} />
                <Route path="audit-logs" element={<AdminAuditPage />} />
              </Route>
            </Route>
            <Route path="settings" element={<SettingsShell />}>
              <Route index element={<SettingsIndexPage />} />
              <Route path="integracion" element={<SettingsIntegrationPage />} />
              <Route path="ia" element={<SettingsAiPage />} />
              <Route
                path="fuera-de-horario"
                element={<SettingsBusinessHoursPage />}
              />
              <Route path="bitacora" element={<SettingsAuditPage />} />
              <Route path="reporteria" element={<SettingsReporteriaPage />} />
            </Route>
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/conversations" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
