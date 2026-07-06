import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WaAppShell } from './WaAppShell'
import { RequireAuth } from './RequireAuth'
import { RequirePasswordChanged } from './RequirePasswordChanged'
import { LoginPage } from '../features/auth/LoginPage'
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { MetaAdsListPage } from '../features/meta-ads/MetaAdsListPage'
import { MetaAdDetailPage } from '../features/meta-ads/MetaAdDetailPage'
import { AttributesShell } from '../features/attributes/AttributesShell'
import { AttributesEmptyPane } from '../features/attributes/AttributesEmptyPane'
import { AttributeNewPage } from '../features/attributes/AttributeNewPage'
import { AttributeDetailPage } from '../features/attributes/AttributeDetailPage'
import { SegmentsShell } from '../features/segments/SegmentsShell'
import { SegmentsEmptyPane } from '../features/segments/SegmentsEmptyPane'
import { SegmentNewPage } from '../features/segments/SegmentNewPage'
import { SegmentDetailPage } from '../features/segments/SegmentDetailPage'
import { ContactsShell } from '../features/contacts/ContactsShell'
import { ContactsEmptyPane } from '../features/contacts/ContactsEmptyPane'
import { ContactImportPage } from '../features/contacts/ContactImportPage'
import { ContactNewPage } from '../features/contacts/ContactNewPage'
import { ContactDetailPage } from '../features/contacts/ContactDetailPage'
import { TemplatesShell } from '../features/templates/TemplatesShell'
import { TemplatesEmptyPane } from '../features/templates/TemplatesEmptyPane'
import { TemplateDetailPage } from '../features/templates/TemplateDetailPage'
import { TemplateNewPage } from '../features/templates/TemplateNewPage'
import { CampaignsListPage } from '../features/campaigns/CampaignsListPage'
import { CampaignNewPage } from '../features/campaigns/CampaignNewPage'
import { CampaignDetailPage } from '../features/campaigns/CampaignDetailPage'
import { SettingsShell } from '../features/settings/SettingsShell'
import { SettingsIndexPage } from '../features/settings/SettingsIndexPage'
import { SettingsIntegrationPage } from '../features/settings/SettingsIntegrationPage'
import { SettingsAiPage } from '../features/settings/SettingsAiPage'
import { SettingsBusinessHoursPage } from '../features/settings/SettingsBusinessHoursPage'
import { SettingsAuditPage } from '../features/settings/SettingsAuditPage'
import { SettingsReporteriaPage } from '../features/settings/SettingsReporteriaPage'
import { ConversationsInboxPage } from '../features/conversations/ConversationsInboxPage'
import { RequireMaster, AdminShell } from '../features/admin/AdminShell'
import { AdminUsersPage } from '../features/admin/AdminUsersPage'
import { AdminUserFormPage } from '../features/admin/AdminUserFormPage'
import { AdminMetaPage } from '../features/admin/AdminMetaPage'
import { AdminAuditPage } from '../features/admin/AdminAuditPage'
import { AdminAreasPage } from '../features/admin/AdminAreasPage'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="account/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequirePasswordChanged />}>
            <Route element={<WaAppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="anuncios" element={<MetaAdsListPage />} />
            <Route path="anuncios/:id" element={<MetaAdDetailPage />} />
            <Route path="attributes" element={<AttributesShell />}>
              <Route index element={<AttributesEmptyPane />} />
              <Route path="new" element={<AttributeNewPage />} />
              <Route path=":id" element={<AttributeDetailPage />} />
            </Route>
            <Route path="segments" element={<SegmentsShell />}>
              <Route index element={<SegmentsEmptyPane />} />
              <Route path="new" element={<SegmentNewPage />} />
              <Route path=":id" element={<SegmentDetailPage />} />
            </Route>
            <Route path="contacts" element={<ContactsShell />}>
              <Route index element={<ContactsEmptyPane />} />
              <Route path="import" element={<ContactImportPage />} />
              <Route path="new" element={<ContactNewPage />} />
              <Route path=":id" element={<ContactDetailPage />} />
            </Route>
            <Route path="templates" element={<TemplatesShell />}>
              <Route index element={<TemplatesEmptyPane />} />
              <Route path="new" element={<TemplateNewPage />} />
              <Route path=":id" element={<TemplateDetailPage />} />
            </Route>
            <Route path="campaigns" element={<CampaignsListPage />} />
            <Route path="campaigns/new" element={<CampaignNewPage />} />
            <Route path="campaigns/:id" element={<CampaignDetailPage />} />
            <Route path="conversations" element={<ConversationsInboxPage />} />
            <Route path="conversations/:id" element={<ConversationsInboxPage />} />
            <Route element={<RequireMaster />}>
              <Route path="admin" element={<AdminShell />}>
                <Route index element={<Navigate to="users" replace />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="users/:id" element={<AdminUserFormPage />} />
                <Route path="areas" element={<AdminAreasPage />} />
                <Route path="meta" element={<AdminMetaPage />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
