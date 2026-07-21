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

export class CrmPatchContactDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  last_name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

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
  @IsArray()
  @IsString({ each: true })
  segment_slugs?: string[];

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}
