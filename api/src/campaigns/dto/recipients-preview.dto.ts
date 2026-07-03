import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class RecipientsPreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  segments!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeSegmentSlugs?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  excludeContactIds?: number[];

  @IsOptional()
  @IsBoolean()
  excludeOpenServiceWindow?: boolean;
}
