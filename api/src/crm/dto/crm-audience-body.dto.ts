import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CrmAudienceBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  area?: string;

  /** Include union of these segment slugs. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  segments?: string[];

  /** Legacy single-segment include (same as GET ?segment=). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  segment?: string;

  /** Exclude contacts that belong to any of these segments. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclude_segments?: string[];

  @IsOptional()
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
}
