import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CrmSyncContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  area?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  last_name?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsBoolean()
  opt_in?: boolean;

  @IsOptional()
  @IsBoolean()
  opt_in_email?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  dni?: string | null;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  /** External id from product system (e.g. PamRegistration.id) */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  external_id?: string;

  /** Segmentos del contacto (ej. amigo, circulo, comunidad en área pam). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  segment_slugs?: string[];
}
