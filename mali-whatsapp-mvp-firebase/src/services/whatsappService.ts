import axios from 'axios';

export interface SendMessageParams {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: any[];
}

export const whatsappService = {
  async sendMessage(params: SendMessageParams) {
    try {
      const response = await axios.post('/api/send-message', params);
      return response.data;
    } catch (error: any) {
      console.error('Error in whatsappService.sendMessage:', error.response?.data || error.message);
      throw error.response?.data || error.message;
    }
  }
};
