import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { isObservable, lastValueFrom } from 'rxjs';
import { MasterGuard } from '../admin/guards/master.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WhatsAppAdminTokenGuard } from './whatsapp-admin-token.guard';

async function asBoolean(
  value: boolean | Promise<boolean> | ReturnType<JwtAuthGuard['canActivate']>,
): Promise<boolean> {
  if (isObservable(value)) return lastValueFrom(value);
  return value;
}

/** Master session or the MALI ONE control-plane token. Either one is enough. */
@Injectable()
export class WhatsAppAdminAccessGuard implements CanActivate {
  constructor(
    private readonly token: WhatsAppAdminTokenGuard,
    private readonly jwt: JwtAuthGuard,
    private readonly master: MasterGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      if (this.token.canActivate(context)) return true;
    } catch {
      // The service token is optional. A master session remains valid.
    }
    const authenticated = await asBoolean(this.jwt.canActivate(context));
    return authenticated && this.master.canActivate(context);
  }
}
