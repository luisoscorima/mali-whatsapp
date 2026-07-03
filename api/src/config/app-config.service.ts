import { Injectable } from '@nestjs/common';
import { BUSINESS_AREAS } from './areas';

@Injectable()
export class AppConfigService {
  readonly requireAuth =
    String(process.env.REQUIRE_AUTH ?? 'false')
      .trim()
      .toLowerCase() === 'true';

  readonly devArea = String(process.env.DEV_AREA || 'ti').trim().toLowerCase();

  readonly jwtSecret =
    String(process.env.JWT_SECRET || '').trim() ||
    (this.requireAuth ? '' : 'dev-jwt-secret-not-for-production');

  readonly jwtExpiresIn = String(process.env.JWT_EXPIRES_IN || '7d').trim();

  readonly businessAreas = [...BUSINESS_AREAS];

  assertJwtSecret(): void {
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET is required when REQUIRE_AUTH=true');
    }
  }
}
