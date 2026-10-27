import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AuditLogService } from '../audit/audit-log.service';
import {
  assertCredentialVaultConfigured,
  decryptMetaToken,
  encryptMetaToken,
  fingerprintMetaToken,
} from '../meta-settings/credential-vault.util';
import { MetaSettingsService } from '../meta-settings/meta-settings.service';
import {
  isWhatsAppLineCatalogEnabled,
  normalizeSecretValue,
} from '../meta-settings/meta-settings.store';
import { isValidBusinessArea } from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import {
  inspectWhatsAppLine,
  inspectWhatsAppWaba,
  listWhatsAppWabaPhoneNumbers,
} from '../templates/whatsapp-meta.util';
import type {
  CreateWhatsAppLineDto,
  CreateWhatsAppWabaDto,
  RotateWhatsAppTokenDto,
  UpdateWhatsAppLineDto,
  UpdateWhatsAppWabaDto,
} from './dto/whatsapp-admin.dto';

type AdminActor = Pick<AuthUser, 'id' | 'email' | 'area'> | { email: string };

@Injectable()
export class WhatsAppAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metaSettings: MetaSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  private actor(actor?: AdminActor) {
    if (!actor) return undefined;
    return {
      userId: 'id' in actor ? actor.id : null,
      email: actor.email,
      area: 'area' in actor ? actor.area : null,
    };
  }

  private async writeAudit(
    event_type: string,
    message: string,
    actor: AdminActor | undefined,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.write({
      event_type,
      message,
      actor: this.actor(actor),
      meta,
    });
  }

  private ensureVault(): void {
    try {
      assertCredentialVaultConfigured();
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async resolveCredentialToken(credential: {
    secret_source: string;
    secret_ref: string | null;
    encrypted_token: string | null;
    active: boolean;
  }): Promise<string> {
    if (!credential.active) throw new Error('La credencial está desactivada');
    const source = String(credential.secret_source || '').trim();
    const ref = String(credential.secret_ref || '').trim();
    if (source === 'encrypted_db' && credential.encrypted_token) {
      return normalizeSecretValue(decryptMetaToken(credential.encrypted_token));
    }
    if (source === 'env' && ref) {
      return normalizeSecretValue(process.env[ref]);
    }
    if (source === 'app_settings' && ref.includes(':')) {
      const [area, ...keyParts] = ref.split(':');
      const row = await this.prisma.app_settings.findUnique({
        where: { area_key: { area, key: keyParts.join(':') } },
      });
      return normalizeSecretValue(row?.value);
    }
    throw new Error('La credencial no tiene una fuente compatible');
  }

  private async effectiveLineCredential(lineId: number) {
    const line = await this.prisma.whatsapp_lines.findUnique({
      where: { id: lineId },
      include: {
        credential_override: true,
        waba: { include: { default_credential: true } },
      },
    });
    if (!line) throw new NotFoundException('Línea WhatsApp no encontrada');
    const credential = line.credential_override || line.waba.default_credential;
    if (!credential) {
      throw new BadRequestException(
        'La línea no tiene una credencial efectiva',
      );
    }
    return { line, credential };
  }

  async overview() {
    let vaultConfigured = true;
    try {
      assertCredentialVaultConfigured();
    } catch {
      vaultConfigured = false;
    }

    const [areas, credentials, wabas, lines] = await Promise.all([
      this.prisma.business_areas.findMany({
        orderBy: [{ sort_order: 'asc' }, { label: 'asc' }],
        include: {
          programs: { orderBy: [{ sort_order: 'asc' }, { label: 'asc' }] },
        },
      }),
      this.prisma.meta_credentials.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.whatsapp_wabas.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.whatsapp_lines.findMany({
        orderBy: [{ business_area_id: 'asc' }, { id: 'asc' }],
        include: { business_area: true, program: true, waba: true },
      }),
    ]);

    return {
      vault_configured: vaultConfigured,
      catalog_enabled: isWhatsAppLineCatalogEnabled(),
      areas: areas.map((area) => ({
        id: area.id,
        slug: area.slug,
        label: area.label,
        active: area.active,
        programs: area.programs.map((program) => ({
          id: program.id,
          slug: program.slug,
          label: program.label,
          active: program.active,
        })),
      })),
      credentials: credentials.map((credential) => ({
        id: credential.id,
        label: credential.label,
        secret_source: credential.secret_source,
        token_configured: Boolean(
          credential.encrypted_token || credential.secret_ref,
        ),
        fingerprint_suffix: credential.token_fingerprint?.slice(-10) || null,
        active: credential.active,
        validation_status: credential.validation_status,
        validation_error: credential.validation_error,
        last_validated_at: credential.last_validated_at,
      })),
      wabas: wabas.map((waba) => ({
        id: waba.id,
        meta_waba_id: waba.meta_waba_id,
        label: waba.label,
        default_credential_id: waba.default_credential_id,
        active: waba.active,
        app_subscription_status: waba.app_subscription_status,
        last_validated_at: waba.last_validated_at,
      })),
      lines: lines.map((line) => ({
        id: line.id,
        business_area_id: line.business_area_id,
        area_slug: line.business_area.slug,
        area_label: line.business_area.label,
        program_id: line.program_id,
        program_slug: line.program?.slug || null,
        program_label: line.program?.label || null,
        waba_id: line.waba_id,
        meta_waba_id: line.waba.meta_waba_id,
        credential_override_id: line.credential_override_id,
        phone_number_id: line.phone_number_id,
        display_phone_number: line.display_phone_number,
        label: line.label,
        legacy_area: line.legacy_area,
        program_key: line.program_key,
        is_default: line.is_default,
        active: line.active,
        registration_status: line.registration_status,
        quality_rating: line.quality_rating,
        last_validated_at: line.last_validated_at,
      })),
    };
  }

  async createWaba(input: CreateWhatsAppWabaDto, actor?: AdminActor) {
    this.ensureVault();
    const token = normalizeSecretValue(input.token);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const credential = await tx.meta_credentials.create({
          data: {
            label:
              input.credential_label?.trim() || `Token ${input.label.trim()}`,
            secret_source: 'encrypted_db',
            secret_ref: null,
            encrypted_token: encryptMetaToken(token),
            token_fingerprint: fingerprintMetaToken(token),
            validation_status: 'unknown',
          },
        });
        const waba = await tx.whatsapp_wabas.create({
          data: {
            meta_waba_id: input.meta_waba_id.trim(),
            label: input.label.trim(),
            default_credential_id: credential.id,
            active: false,
          },
        });
        return { waba, credential_id: credential.id };
      });
      await this.metaSettings.refresh();
      await this.writeAudit(
        'admin.whatsapp_waba_created',
        'WABA creado como borrador',
        actor,
        { waba_id: result.waba.id, meta_waba_id: result.waba.meta_waba_id },
      );
      return result;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('El WABA ya está registrado');
      }
      throw error;
    }
  }

  async updateWaba(
    id: number,
    input: UpdateWhatsAppWabaDto,
    actor?: AdminActor,
  ) {
    const current = await this.prisma.whatsapp_wabas.findUnique({
      where: { id },
      include: { default_credential: true },
    });
    if (!current) throw new NotFoundException('WABA no encontrado');
    if (
      input.active === true &&
      current.default_credential?.validation_status !== 'valid'
    ) {
      throw new BadRequestException(
        'Valida correctamente la credencial antes de activar el WABA',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.active === false) {
        await tx.whatsapp_lines.updateMany({
          where: { waba_id: id, active: true },
          data: { active: false, is_default: false, updated_at: new Date() },
        });
      }
      return tx.whatsapp_wabas.update({
        where: { id },
        data: {
          ...(input.label !== undefined ? { label: input.label.trim() } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updated_at: new Date(),
        },
      });
    });
    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_waba_updated',
      'WABA actualizado',
      actor,
      { waba_id: id, active: updated.active },
    );
    return updated;
  }

  async validateWaba(id: number, actor?: AdminActor) {
    const waba = await this.prisma.whatsapp_wabas.findUnique({
      where: { id },
      include: { default_credential: true },
    });
    if (!waba) throw new NotFoundException('WABA no encontrado');
    if (!waba.default_credential) {
      throw new BadRequestException('El WABA no tiene credencial');
    }

    try {
      const token = await this.resolveCredentialToken(waba.default_credential);
      const inspection = await inspectWhatsAppWaba(waba.meta_waba_id, token);
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.meta_credentials.update({
          where: { id: waba.default_credential.id },
          data: {
            validation_status: 'valid',
            validation_error: null,
            last_validated_at: now,
            updated_at: now,
          },
        }),
        this.prisma.whatsapp_wabas.update({
          where: { id },
          data: {
            active: true,
            app_subscription_status: inspection.appSubscriptionStatus,
            last_validated_at: now,
            updated_at: now,
          },
        }),
      ]);
      await this.metaSettings.refresh();
      await this.writeAudit(
        'admin.whatsapp_waba_validated',
        'WABA validado contra Meta',
        actor,
        {
          waba_id: id,
          subscription_status: inspection.appSubscriptionStatus,
        },
      );
      return inspection;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.meta_credentials.update({
        where: { id: waba.default_credential.id },
        data: {
          validation_status: 'invalid',
          validation_error: message.slice(0, 4000),
          last_validated_at: new Date(),
          updated_at: new Date(),
        },
      });
      await this.writeAudit(
        'admin.whatsapp_waba_validation_failed',
        'Falló la validación del WABA',
        actor,
        { waba_id: id, error: message },
      );
      throw new BadRequestException(message);
    }
  }

  /**
   * Trae los números de Meta para esta WABA.
   * Crea borradores inactivos para los nuevos; actualiza display/quality de los ya registrados.
   * No activa, no borra, no toca tokens.
   */
  async syncWabaLines(id: number, actor?: AdminActor) {
    const waba = await this.prisma.whatsapp_wabas.findUnique({
      where: { id },
      include: { default_credential: true },
    });
    if (!waba) throw new NotFoundException('WABA no encontrado');
    if (!waba.default_credential) {
      throw new BadRequestException('El WABA no tiene credencial');
    }

    const existing = await this.prisma.whatsapp_lines.findMany({
      where: { waba_id: id },
      select: {
        id: true,
        phone_number_id: true,
        label: true,
        display_phone_number: true,
        quality_rating: true,
        active: true,
        registration_status: true,
        business_area_id: true,
      },
    });
    const areaIds = Array.from(
      new Set(existing.map((line) => line.business_area_id)),
    );
    if (areaIds.length === 0) {
      throw new BadRequestException(
        'Esta WABA no tiene líneas. Crea al menos una a mano para fijar el área y luego sincroniza.',
      );
    }
    if (areaIds.length > 1) {
      throw new BadRequestException(
        'Esta WABA tiene líneas en más de un área; no se puede sincronizar automáticamente.',
      );
    }
    const businessAreaId = areaIds[0];
    const area = await this.prisma.business_areas.findUnique({
      where: { id: businessAreaId },
      select: { id: true, slug: true, active: true },
    });
    if (!area?.active || !isValidBusinessArea(area.slug)) {
      throw new BadRequestException('El área de esta WABA no está habilitada');
    }

    let metaLines;
    try {
      const token = await this.resolveCredentialToken(waba.default_credential);
      metaLines = await listWhatsAppWabaPhoneNumbers(waba.meta_waba_id, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }

    const byPid = new Map(
      existing.map((line) => [line.phone_number_id, line] as const),
    );
    const created: { id: number; phone_number_id: string; label: string }[] =
      [];
    const updated: { id: number; phone_number_id: string; label: string }[] =
      [];
    const unchanged: { id: number; phone_number_id: string; label: string }[] =
      [];
    const skipped: { phone_number_id: string; reason: string }[] = [];
    const now = new Date();

    for (const meta of metaLines) {
      const local = byPid.get(meta.id);
      if (!local) {
        const elsewhere = await this.prisma.whatsapp_lines.findUnique({
          where: { phone_number_id: meta.id },
          select: { id: true, waba_id: true, label: true },
        });
        if (elsewhere) {
          skipped.push({
            phone_number_id: meta.id,
            reason: `Ya existe en otra WABA (línea #${elsewhere.id} «${elsewhere.label}»)`,
          });
          continue;
        }
        const label = (
          meta.verifiedName ||
          meta.displayPhoneNumber ||
          `Línea ${meta.id.slice(-6)}`
        ).slice(0, 120);
        const row = await this.prisma.whatsapp_lines.create({
          data: {
            business_area_id: businessAreaId,
            waba_id: id,
            phone_number_id: meta.id,
            display_phone_number: meta.displayPhoneNumber,
            label,
            quality_rating: meta.qualityRating,
            is_default: false,
            active: false,
            registration_status: 'draft',
            last_validated_at: now,
          },
          select: { id: true, phone_number_id: true, label: true },
        });
        created.push(row);
        continue;
      }

      const nextDisplay = meta.displayPhoneNumber;
      const nextQuality = meta.qualityRating;
      const nextLabel =
        !local.active &&
        (local.registration_status === 'draft' ||
          local.registration_status === 'unknown') &&
        meta.verifiedName
          ? meta.verifiedName.slice(0, 120)
          : local.label;
      const displayChanged =
        (nextDisplay || null) !== (local.display_phone_number || null);
      const qualityChanged =
        (nextQuality || null) !== (local.quality_rating || null);
      const labelChanged = nextLabel !== local.label;
      if (!displayChanged && !qualityChanged && !labelChanged) {
        unchanged.push({
          id: local.id,
          phone_number_id: local.phone_number_id,
          label: local.label,
        });
        continue;
      }
      await this.prisma.whatsapp_lines.update({
        where: { id: local.id },
        data: {
          ...(displayChanged
            ? { display_phone_number: nextDisplay }
            : {}),
          ...(qualityChanged ? { quality_rating: nextQuality } : {}),
          ...(labelChanged ? { label: nextLabel } : {}),
          updated_at: now,
        },
      });
      updated.push({
        id: local.id,
        phone_number_id: local.phone_number_id,
        label: nextLabel,
      });
    }

    const metaIds = new Set(metaLines.map((line) => line.id));
    const missing_in_meta = existing
      .filter((line) => !metaIds.has(line.phone_number_id))
      .map((line) => ({
        id: line.id,
        phone_number_id: line.phone_number_id,
        label: line.label,
      }));

    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_waba_lines_synced',
      'Números de WABA sincronizados desde Meta',
      actor,
      {
        waba_id: id,
        created: created.length,
        updated: updated.length,
        unchanged: unchanged.length,
        missing_in_meta: missing_in_meta.length,
        skipped: skipped.length,
      },
    );

    return {
      waba_id: id,
      meta_count: metaLines.length,
      created,
      updated,
      unchanged,
      missing_in_meta,
      skipped,
    };
  }

  async rotateWabaToken(
    id: number,
    input: RotateWhatsAppTokenDto,
    actor?: AdminActor,
  ) {
    this.ensureVault();
    const waba = await this.prisma.whatsapp_wabas.findUnique({
      where: { id },
      include: { default_credential: true },
    });
    if (!waba) throw new NotFoundException('WABA no encontrado');
    const token = normalizeSecretValue(input.token);

    // Validate before replacing the live credential, so a typo cannot cut service.
    const inspection = await inspectWhatsAppWaba(
      waba.meta_waba_id,
      token,
    ).catch((error) => {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    });
    const encrypted = encryptMetaToken(token);
    const fingerprint = fingerprintMetaToken(token);
    const now = new Date();
    const credential = await this.prisma.$transaction(async (tx) => {
      // Fresh credentials preserve explicit overrides on other lines.
      const created = await tx.meta_credentials.create({
        data: {
          label: input.credential_label?.trim() || `Token ${waba.label}`,
          secret_source: 'encrypted_db',
          encrypted_token: encrypted,
          token_fingerprint: fingerprint,
          validation_status: 'valid',
          last_validated_at: now,
        },
      });
      await tx.whatsapp_wabas.update({
        where: { id },
        data: {
          default_credential_id: created.id,
          app_subscription_status: inspection.appSubscriptionStatus,
          last_validated_at: now,
          updated_at: now,
        },
      });
      return created;
    });
    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_token_rotated',
      'Token del WABA rotado y validado',
      actor,
      { waba_id: id, credential_id: credential.id },
    );
    return inspection;
  }

  private async assertProgram(areaId: number, programId?: number | null) {
    const area = await this.prisma.business_areas.findUnique({
      where: { id: areaId },
    });
    if (!area || !area.active) {
      throw new BadRequestException('El área no existe o está inactiva');
    }
    if (!programId) return { area, program: null };
    const program = await this.prisma.business_programs.findFirst({
      where: { id: programId, business_area_id: areaId, active: true },
    });
    if (!program) {
      throw new BadRequestException(
        'El programa no pertenece al área seleccionada o está inactivo',
      );
    }
    return { area, program };
  }

  async createLine(input: CreateWhatsAppLineDto, actor?: AdminActor) {
    const { area, program } = await this.assertProgram(
      input.business_area_id,
      input.program_id,
    );
    if (!isValidBusinessArea(area.slug)) {
      throw new BadRequestException(
        'El área no está habilitada en la aplicación',
      );
    }
    // New lines always belong to the canonical business area. Legacy aliases
    // are only preserved on imported rows, never assigned to new numbers.
    if (input.legacy_area) {
      throw new BadRequestException(
        'Las líneas nuevas usan el área canónica y un programa opcional, sin alias heredado',
      );
    }
    const waba = await this.prisma.whatsapp_wabas.findUnique({
      where: { id: input.waba_id },
    });
    if (!waba) throw new BadRequestException('El WABA no existe');
    if (!input.token && !waba.default_credential_id) {
      throw new BadRequestException(
        'Configura un token compartido en el WABA o un token propio para la línea',
      );
    }
    if (input.token) this.ensureVault();

    try {
      const line = await this.prisma.$transaction(async (tx) => {
        let credentialId: number | null = null;
        if (input.token) {
          const token = normalizeSecretValue(input.token);
          const credential = await tx.meta_credentials.create({
            data: {
              label:
                input.credential_label?.trim() || `Token ${input.label.trim()}`,
              secret_source: 'encrypted_db',
              encrypted_token: encryptMetaToken(token),
              token_fingerprint: fingerprintMetaToken(token),
            },
          });
          credentialId = credential.id;
        }
        return tx.whatsapp_lines.create({
          data: {
            business_area_id: area.id,
            program_id: program?.id || null,
            program_key: program?.slug || null,
            waba_id: input.waba_id,
            credential_override_id: credentialId,
            phone_number_id: input.phone_number_id.trim(),
            label: input.label.trim(),
            legacy_area: input.legacy_area?.trim() || null,
            // A line always starts as a draft, even when requested as default.
            is_default: Boolean(input.is_default),
            active: false,
            registration_status: 'draft',
          },
        });
      });
      await this.metaSettings.refresh();
      await this.writeAudit(
        'admin.whatsapp_line_created',
        'Línea WhatsApp creada como borrador',
        actor,
        {
          line_id: line.id,
          area: area.slug,
          program: program?.slug || null,
          phone_number_id: line.phone_number_id,
        },
      );
      return line;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('El Phone Number ID ya está registrado');
      }
      throw error;
    }
  }

  async moveLineCategory(id: number, programId: number | null, actor?: AdminActor) {
    const current = await this.prisma.whatsapp_lines.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Línea WhatsApp no encontrada');
    const { program } = await this.assertProgram(current.business_area_id, programId);
    const updated = await this.prisma.whatsapp_lines.update({
      where: { id },
      data: {
        program_id: program?.id ?? null,
        program_key: program?.slug ?? null,
        updated_at: new Date(),
      },
      select: { id: true, label: true, program_id: true, program_key: true },
    });
    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_line_category_moved',
      'Línea movida de categoría',
      actor,
      {
        line_id: id,
        program_id: updated.program_id,
        program_key: updated.program_key,
      },
    );
    return updated;
  }

  async updateLine(
    id: number,
    input: UpdateWhatsAppLineDto,
    actor?: AdminActor,
  ) {
    const current = await this.prisma.whatsapp_lines.findUnique({
      where: { id },
      include: { _count: { select: { conversations: true, campaigns: true } } },
    });
    if (!current) throw new NotFoundException('Línea WhatsApp no encontrada');
    if (
      input.legacy_area !== undefined &&
      (input.legacy_area || null) !== current.legacy_area
    ) {
      throw new BadRequestException(
        'El alias heredado no se cambia desde administración',
      );
    }
    const areaId = input.business_area_id ?? current.business_area_id;
    const programId =
      input.program_id !== undefined ? input.program_id : current.program_id;
    const { program } = await this.assertProgram(areaId, programId);

    const identityChanged =
      (input.business_area_id !== undefined &&
        input.business_area_id !== current.business_area_id) ||
      (input.program_id !== undefined &&
        input.program_id !== current.program_id) ||
      (input.waba_id !== undefined && input.waba_id !== current.waba_id) ||
      (input.phone_number_id !== undefined &&
        input.phone_number_id.trim() !== current.phone_number_id) ||
      (input.legacy_area !== undefined &&
        (input.legacy_area?.trim() || null) !== current.legacy_area);
    if (
      identityChanged &&
      (current._count.conversations > 0 || current._count.campaigns > 0)
    ) {
      throw new BadRequestException(
        'La identidad de una línea con historial no se modifica; desactívala y crea una nueva',
      );
    }
    if (identityChanged && current.active) {
      throw new BadRequestException(
        'Desactiva la línea antes de modificar su identidad',
      );
    }

    if (input.waba_id !== undefined) {
      const waba = await this.prisma.whatsapp_wabas.findUnique({
        where: { id: input.waba_id },
      });
      if (!waba) throw new BadRequestException('El WABA no existe');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Serialize default changes within an area, including concurrent admins.
      await tx.$queryRaw`SELECT id FROM business_areas WHERE id = ${areaId} FOR UPDATE`;
      if (input.is_default === true && current.active) {
        await tx.whatsapp_lines.updateMany({
          where: {
            business_area_id: areaId,
            active: true,
            is_default: true,
            NOT: { id },
          },
          data: { is_default: false, updated_at: new Date() },
        });
      }
      return tx.whatsapp_lines.update({
        where: { id },
        data: {
          ...(input.business_area_id !== undefined
            ? { business_area_id: input.business_area_id }
            : {}),
          ...(input.program_id !== undefined
            ? {
                program_id: input.program_id,
                program_key: program?.slug || null,
              }
            : {}),
          ...(input.waba_id !== undefined ? { waba_id: input.waba_id } : {}),
          ...(input.phone_number_id !== undefined
            ? { phone_number_id: input.phone_number_id.trim() }
            : {}),
          ...(input.label !== undefined ? { label: input.label.trim() } : {}),
          ...(input.legacy_area !== undefined
            ? { legacy_area: input.legacy_area?.trim() || null }
            : {}),
          ...(input.is_default !== undefined
            ? { is_default: input.is_default }
            : {}),
          ...(identityChanged
            ? { registration_status: 'draft', last_validated_at: null }
            : {}),
          updated_at: new Date(),
        },
      });
    });
    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_line_updated',
      'Línea WhatsApp actualizada',
      actor,
      { line_id: id, identity_changed: identityChanged },
    );
    return updated;
  }

  async validateLine(id: number, actor?: AdminActor) {
    const { line, credential } = await this.effectiveLineCredential(id);
    try {
      const token = await this.resolveCredentialToken(credential);
      const inspection = await inspectWhatsAppLine(
        line.waba.meta_waba_id,
        line.phone_number_id,
        token,
      );
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.meta_credentials.update({
          where: { id: credential.id },
          data: {
            validation_status: 'valid',
            validation_error: null,
            last_validated_at: now,
            updated_at: now,
          },
        }),
        this.prisma.whatsapp_lines.update({
          where: { id },
          data: {
            display_phone_number: inspection.displayPhoneNumber,
            quality_rating: inspection.qualityRating,
            registration_status: 'validated',
            last_validated_at: now,
            updated_at: now,
          },
        }),
      ]);
      await this.metaSettings.refresh();
      await this.writeAudit(
        'admin.whatsapp_line_validated',
        'Línea WhatsApp validada contra Meta',
        actor,
        { line_id: id, phone_number_id: line.phone_number_id },
      );
      return inspection;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date();
      // A line membership failure does not invalidate a token shared by other lines.
      await this.prisma.$transaction([
        this.prisma.whatsapp_lines.update({
          where: { id },
          data: {
            registration_status: 'invalid',
            last_validated_at: now,
            updated_at: now,
          },
        }),
      ]);
      await this.metaSettings.refresh();
      await this.writeAudit(
        'admin.whatsapp_line_validation_failed',
        'Falló la validación de la línea WhatsApp',
        actor,
        { line_id: id, error: message },
      );
      throw new BadRequestException(message);
    }
  }

  async rotateLineToken(
    id: number,
    input: RotateWhatsAppTokenDto,
    actor?: AdminActor,
  ) {
    this.ensureVault();
    const line = await this.prisma.whatsapp_lines.findUnique({
      where: { id },
      include: { waba: true },
    });
    if (!line) throw new NotFoundException('Línea WhatsApp no encontrada');
    const token = normalizeSecretValue(input.token);
    const inspection = await inspectWhatsAppLine(
      line.waba.meta_waba_id,
      line.phone_number_id,
      token,
    ).catch((error) => {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    });
    const now = new Date();
    const credential = await this.prisma.$transaction(async (tx) => {
      // Fresh credentials preserve explicit overrides on other lines.
      const created = await tx.meta_credentials.create({
        data: {
          label: input.credential_label?.trim() || `Token ${line.label}`,
          secret_source: 'encrypted_db',
          encrypted_token: encryptMetaToken(token),
          token_fingerprint: fingerprintMetaToken(token),
          validation_status: 'valid',
          last_validated_at: now,
        },
      });
      await tx.whatsapp_lines.update({
        where: { id },
        data: {
          credential_override_id: created.id,
          display_phone_number: inspection.displayPhoneNumber,
          quality_rating: inspection.qualityRating,
          registration_status: 'validated',
          last_validated_at: now,
          updated_at: now,
        },
      });
      return created;
    });
    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_line_token_rotated',
      'Token propio de la línea rotado y validado',
      actor,
      { line_id: id, credential_id: credential.id },
    );
    return inspection;
  }

  async activateLine(id: number, actor?: AdminActor) {
    if (!isWhatsAppLineCatalogEnabled()) {
      throw new BadRequestException(
        'Activa WHATSAPP_LINE_CATALOG_ENABLED antes de habilitar líneas del catálogo',
      );
    }
    const { line, credential } = await this.effectiveLineCredential(id);
    await this.assertProgram(line.business_area_id, line.program_id);
    if (!line.waba.active) {
      throw new BadRequestException('El WABA está inactivo');
    }
    if (!credential.active || credential.validation_status !== 'valid') {
      throw new BadRequestException('La credencial no está validada');
    }
    if (line.registration_status !== 'validated' || !line.last_validated_at) {
      throw new BadRequestException('Valida la línea antes de activarla');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM business_areas WHERE id = ${line.business_area_id} FOR UPDATE`;
      if (line.is_default) {
        await tx.whatsapp_lines.updateMany({
          where: {
            business_area_id: line.business_area_id,
            active: true,
            is_default: true,
            NOT: { id },
          },
          data: { is_default: false, updated_at: new Date() },
        });
      }
      return tx.whatsapp_lines.update({
        where: { id },
        data: { active: true, updated_at: new Date() },
      });
    });
    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_line_activated',
      'Línea WhatsApp activada',
      actor,
      { line_id: id },
    );
    return updated;
  }

  async deactivateLine(id: number, actor?: AdminActor) {
    const current = await this.prisma.whatsapp_lines.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Línea WhatsApp no encontrada');
    const updated = await this.prisma.whatsapp_lines.update({
      where: { id },
      data: { active: false, is_default: false, updated_at: new Date() },
    });
    await this.metaSettings.refresh();
    await this.writeAudit(
      'admin.whatsapp_line_deactivated',
      'Línea WhatsApp desactivada',
      actor,
      { line_id: id },
    );
    return updated;
  }
}
