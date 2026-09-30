import { Injectable, Logger } from '@nestjs/common';

interface ExternalLeaveResponse {
  externalId: string;
}

@Injectable()
export class LeaveApiClient {
  private readonly logger = new Logger(LeaveApiClient.name);
  private readonly baseUrl = process.env.LEAVE_API_URL;

  async submitLeaveRequest(payload: {
    userId: string;
    startDate: string;
    endDate: string;
    type: string;
  }): Promise<ExternalLeaveResponse | null> {
    if (!this.baseUrl) {
      this.logger.warn('LEAVE_API_URL non configuree, envoi ignore pour le moment');
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/leave-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.error(`API conges a repondu avec le statut ${response.status}`);
        return null;
      }

      const data = await response.json();
      return { externalId: data.id };
    } catch (error) {
      this.logger.error('Echec de l\'appel a l\'API conges', error);
      return null;
    }
  }
}