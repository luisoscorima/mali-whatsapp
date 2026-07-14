import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SEGMENT_COLOR_KEYS } from '../segments.types';

export class CreateSegmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsIn(SEGMENT_COLOR_KEYS)
  color_key?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  show_in_filter?: boolean;

  @IsOptional()
  @IsBoolean()
  assignable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  assignment_group?: string | null;
}

export class UpdateSegmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsIn(SEGMENT_COLOR_KEYS)
  color_key?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  show_in_filter?: boolean;

  @IsOptional()
  @IsBoolean()
  assignable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  assignment_group?: string | null;
}
