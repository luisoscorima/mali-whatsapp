import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListContactsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  segment?: string | string[];

  @IsOptional()
  @IsString()
  show_replaced?: string;

  @IsOptional()
  @IsString()
  attr_key?: string;

  @IsOptional()
  @IsString()
  attr_value?: string;

  @IsOptional()
  @IsString()
  attrs?: string;
}
