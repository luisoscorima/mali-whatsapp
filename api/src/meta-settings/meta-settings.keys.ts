export const META_SETTING_KEYS = {
  verifyToken: 'meta.verify_token',
  appSecret: 'meta.app_secret',
  whatsappToken: 'meta.whatsapp_token',
  phoneNumberId: 'meta.phone_number_id',
  /** Número visible (+51…) obtenido de Graph; no hardcodear. */
  displayPhoneNumber: 'meta.display_phone_number',
  wabaId: 'meta.waba_id',
  pageAccessToken: 'meta.page_access_token',
  pageId: 'meta.page_id',
} as const;
