import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

export class CrmAudienceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  segment?: string;

  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  opt_in_email?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  attr_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  attr_value?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 500 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
}
