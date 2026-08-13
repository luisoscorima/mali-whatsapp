import {
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CrmIngestOriginDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  area?: string;

  @IsString()
  @MaxLength(32)
  channel!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  external_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  source_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source_label?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  last_name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  dni?: string | null;

  @IsOptional()
  @IsBoolean()
  opt_in?: boolean;

  @IsOptional()
  @IsBoolean()
  opt_in_email?: boolean;
}
