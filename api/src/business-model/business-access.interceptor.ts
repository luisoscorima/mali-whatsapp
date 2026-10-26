import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithBusinessAccess } from './business-access.context';
import type { AuthUser } from '../auth/auth.types';
/** Request-local scope; never mutable global state shared by concurrent users. */
@Injectable()
export class BusinessAccessInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) return next.handle();
    return new Observable(subscriber => runWithBusinessAccess(user, () => {
      const subscription = next.handle().subscribe(subscriber);
      return () => subscription.unsubscribe();
    }));
  }
}
