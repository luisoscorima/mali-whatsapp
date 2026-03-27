export interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'sending' | 'completed' | 'failed';
  createdAt: string;
  totalMessages: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  templateName: string;
}

export interface Recipient {
  id: string;
  campaignId: string;
  phoneNumber: string;
  name: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  errorMessage?: string;
  sentAt?: string;
}
