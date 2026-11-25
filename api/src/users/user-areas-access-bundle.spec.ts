import {
  categoriesFromEducationSlugs,
  explicitEducationCategories,
  UserAreasService,
  type AccessBundle,
  type AccessMembership,
} from './user-areas.service';

function membership(partial: {
  slug: string;
  access_mode?: string;
  include_general?: boolean;
  programs?: { program_id: number; program: { slug: string; active: boolean } }[];
  lines?: { line_id: number }[];
  role_slug?: string;
}): AccessMembership {
  return {
    business_area_id: 1,
    business_area: { id: 1, slug: partial.slug, active: true },
    role_slug: partial.role_slug ?? 'asesor_comercial',
    access_mode: partial.access_mode ?? 'all',
    include_general: partial.include_general ?? false,
    programs: partial.programs ?? [],
    lines: partial.lines ?? [],
  };
}

describe('auth access bundle (paridad de permisos)', () => {
  const service = Object.create(UserAreasService.prototype) as UserAreasService;

  it('explicitEducationCategories: restricted CA+EP', () => {
    const cats = explicitEducationCategories({
      access_mode: 'restricted',
      include_general: false,
      programs: [
        { program: { slug: 'ca', active: true } },
        { program: { slug: 'ep', active: true } },
      ],
    });
    expect(cats).toEqual(['ca', 'ep']);
  });

  it('explicitEducationCategories: all sin grants = membership legacy (null)', () => {
    // Sin restricted / include_general / programs → se heredan áreas marcadas.
    const cats = explicitEducationCategories({
      access_mode: 'all',
      include_general: false,
      programs: [],
    });
    expect(cats).toBeNull();
  });

  it('categoriesFromEducationSlugs hereda de áreas marcadas', () => {
    expect(
      categoriesFromEducationSlugs(['educacion', 'educacion_ca']),
    ).toEqual(['general', 'ca']);
  });

  it('allowedAreasFromBundle: master ve todas', () => {
    const bundle: AccessBundle = { memberships: [], areaSlugs: [] };
    const areas = service.allowedAreasFromBundle(bundle, true);
    expect(areas.length).toBeGreaterThan(1);
    expect(areas).toContain('educacion');
  });

  it('allowedAreasFromBundle: membresía pam sin educación', () => {
    const bundle: AccessBundle = {
      memberships: [membership({ slug: 'pam' })],
      areaSlugs: ['pam'],
    };
    const areas = service.allowedAreasFromBundle(bundle, false);
    expect(areas).toContain('pam');
    expect(areas).not.toContain('educacion');
  });

  it('allowedAreasFromBundle: educación restricted solo CA', () => {
    const bundle: AccessBundle = {
      memberships: [
        membership({
          slug: 'educacion',
          access_mode: 'restricted',
          include_general: false,
          programs: [{ program_id: 2, program: { slug: 'ca', active: true } }],
        }),
      ],
      areaSlugs: ['educacion'],
    };
    const areas = service.allowedAreasFromBundle(bundle, false);
    expect(areas).toContain('educacion');
    expect(areas).toContain('educacion_ca');
    expect(areas).not.toContain('educacion_ep');
  });

  it('allowedAreasFromBundle: educación heredada de user_areas si membership legacy', () => {
    const bundle: AccessBundle = {
      memberships: [
        membership({
          slug: 'educacion',
          access_mode: 'all',
          include_general: false,
          programs: [],
        }),
      ],
      // explicit null → marked desde área primaria educacion (= general)
      areaSlugs: ['educacion', 'educacion_ca'],
    };
    const areas = service.allowedAreasFromBundle(bundle, false);
    expect(areas).toContain('educacion');
    expect(areas).toContain('educacion_ca');
    expect(areas).not.toContain('educacion_ep');
  });
});
