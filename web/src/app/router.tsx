import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequireAuth } from './RequireAuth'
import { LoginPage } from '../features/auth/LoginPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { MetaAdsListPage } from '../features/meta-ads/MetaAdsListPage'
import { MetaAdDetailPage } from '../features/meta-ads/MetaAdDetailPage'
import { AttributesListPage } from '../features/attributes/AttributesListPage'
import { AttributeNewPage } from '../features/attributes/AttributeNewPage'
import { AttributeDetailPage } from '../features/attributes/AttributeDetailPage'
import { SegmentsListPage } from '../features/segments/SegmentsListPage'
import { SegmentNewPage } from '../features/segments/SegmentNewPage'
import { SegmentDetailPage } from '../features/segments/SegmentDetailPage'
import { ContactsListPage } from '../features/contacts/ContactsListPage'
import { ContactImportPage } from '../features/contacts/ContactImportPage'
import { ContactNewPage } from '../features/contacts/ContactNewPage'
import { ContactDetailPage } from '../features/contacts/ContactDetailPage'
import { TemplatesListPage } from '../features/templates/TemplatesListPage'
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

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="anuncios" element={<MetaAdsListPage />} />
            <Route path="anuncios/:id" element={<MetaAdDetailPage />} />
            <Route path="attributes" element={<AttributesListPage />} />
            <Route path="attributes/new" element={<AttributeNewPage />} />
            <Route path="attributes/:id" element={<AttributeDetailPage />} />
            <Route path="segments" element={<SegmentsListPage />} />
            <Route path="segments/new" element={<SegmentNewPage />} />
            <Route path="segments/:id" element={<SegmentDetailPage />} />
            <Route path="contacts" element={<ContactsListPage />} />
            <Route path="contacts/import" element={<ContactImportPage />} />
            <Route path="contacts/new" element={<ContactNewPage />} />
            <Route path="contacts/:id" element={<ContactDetailPage />} />
            <Route path="templates" element={<TemplatesListPage />} />
            <Route path="templates/new" element={<TemplateNewPage />} />
            <Route path="templates/:id" element={<TemplateDetailPage />} />
            <Route path="campaigns" element={<CampaignsListPage />} />
            <Route path="campaigns/new" element={<CampaignNewPage />} />
            <Route path="campaigns/:id" element={<CampaignDetailPage />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
