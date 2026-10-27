import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const META_ID = /^\d{5,32}$/;
const SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export class CreateWhatsAppWabaDto {
  @IsString()
  @Matches(META_ID)
  meta_waba_id!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  @IsString()
  @MinLength(20)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  credential_label?: string;
}

export class UpdateWhatsAppWabaDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class RotateWhatsAppTokenDto {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  credential_label?: string;
}

export class RegisterWhatsAppLineDto {
  /** PIN de verificación en dos pasos (6 dígitos) del número en Meta. */
  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;
}

export class CreateWhatsAppLineDto {
  @IsInt()
  @Min(1)
  business_area_id!: number;

  @IsInt()
  @Min(1)
  waba_id!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  program_id?: number | null;

  @IsString()
  @Matches(META_ID)
  phone_number_id!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG)
  @MaxLength(40)
  legacy_area?: string | null;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  /** Optional per-line override. Normally the line inherits its WABA token. */
  @IsOptional()
  @IsString()
  @MinLength(20)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  credential_label?: string;
}

export class UpdateWhatsAppLineDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  business_area_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  waba_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  program_id?: number | null;

  @IsOptional()
  @IsString()
  @Matches(META_ID)
  phone_number_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG)
  @MaxLength(40)
  legacy_area?: string | null;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

