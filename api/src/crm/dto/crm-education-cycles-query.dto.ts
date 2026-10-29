import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CrmEducationCyclesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(['open', 'closed', 'review', 'unassigned'])
  view?: 'open' | 'closed' | 'review' | 'unassigned';

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 50 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
