import { Transform } from 'class-transformer';
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

function cleanOptionalEmail(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const cleaned = String(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .toLowerCase();
  return cleaned === '' ? null : cleaned;
}

export class UpsertContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  last_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  phone_prefix?: string;

  @IsOptional()
  @IsString()
  phone_local?: string;

  @IsOptional()
  @Transform(({ value }) => cleanOptionalEmail(value))
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @IsOptional()
  @IsBoolean()
  opt_in_email?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  dni?: string | null;

  @IsArray()
  @IsString({ each: true })
  segments!: string[];

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}
