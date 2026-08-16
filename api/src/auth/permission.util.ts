import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth.types';

export function assertCanManageAttributes(user: AuthUser): void {
  if (!user.canManageAttributes) {
    throw new ForbiddenException('No tienes permiso para gestionar atributos');
  }
}

export function assertCanManageSegments(user: AuthUser): void {
  if (!user.canManageSegments) {
    throw new ForbiddenException('No tienes permiso para gestionar segmentos');
  }
}

export function assertCanManageLeads(user: AuthUser): void {
  if (!user.canManageLeads) {
    throw new ForbiddenException('No tienes permiso para gestionar leads');
  }
}

export function assertCanViewCampaignStats(user: AuthUser): void {
  if (!user.canViewCampaignStats) {
    throw new ForbiddenException(
      'No tienes permiso para ver estadísticas de campañas',
    );
  }
}
