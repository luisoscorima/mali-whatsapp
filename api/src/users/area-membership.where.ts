import { Prisma } from '@prisma/client';
import { businessReadScope } from '../config/areas';

/** Users who may work the selected area slug, including a restricted category grant. */
export function userWorksArea(area: string): Prisma.usersWhereInput {
  const scope = businessReadScope(area);
  const grant = scope.program
    ? {
        OR: [
          { access_mode: 'all' },
          { programs: { some: { program: { slug: scope.program, active: true } } } },
        ],
      }
    : {
        OR: [
          { access_mode: 'all' },
          { programs: { some: { program: { active: true } } } },
        ],
      };
  return {
    memberships: {
      some: {
        active: true,
        business_area: { slug: scope.canonicalArea, active: true },
        ...grant,
      },
    },
  };
}
