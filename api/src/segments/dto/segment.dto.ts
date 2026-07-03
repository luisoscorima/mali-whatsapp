import {
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
}
