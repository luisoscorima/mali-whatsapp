import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebhookService } from './webhook.service';
import type { MetaWebhookBody } from './webhook.types';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    this.webhookService.handleVerification(mode, token, challenge, res);
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const body = req.body as MetaWebhookBody;
    await this.webhookService.handlePost(req, body);
    res.sendStatus(200);
  }
}
