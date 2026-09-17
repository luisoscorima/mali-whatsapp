import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TikTokLeadgenService } from '../leads/tiktok-leadgen.service';
import { WebhookService } from './webhook.service';
import type { MetaWebhookBody } from './webhook.types';

function resolveJsonBody(req: Request, body?: unknown): unknown {
  const hasKeys = (v: unknown) =>
    !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;

  if (hasKeys(body)) return body;
  if (hasKeys(req.body)) return req.body;

  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (Buffer.isBuffer(raw) && raw.length > 0) {
    try {
      return JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      /* ignore */
    }
  }
  return body ?? req.body ?? {};
}

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly tiktokLeadgen: TikTokLeadgenService,
  ) {}

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

  /**
   * TikTok Lead Gen / Custom API CRM.
   * URL pública: `{APP_BASE_URL}/webhook/tiktok`
   * Auth opcional: Bearer / X-TikTok-Token / ?token= == TIKTOK_WEBHOOK_SECRET
   */
  @Get('tiktok')
  verifyTikTok(
    @Query('challenge') challenge: string | undefined,
    @Query('echostr') echostr: string | undefined,
    @Res() res: Response,
  ): void {
    const value = challenge || echostr;
    if (value) {
      res.status(200).send(String(value));
      return;
    }
    res.status(200).json({ ok: true, service: 'tiktok-leads' });
  }

  @Post('tiktok')
  @HttpCode(200)
  async receiveTikTok(
    @Req() req: Request,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    this.tiktokLeadgen.assertWebhookAuth(req);
    const payload = resolveJsonBody(req, body);
    const n = await this.tiktokLeadgen.processWebhook(payload);
    res.status(200).json({ ok: true, ingested: n });
  }
}
