import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateAiConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  transfer_keyword?: string;
}

export class EnableAiDto {
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateBusinessHoursDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @IsString()
  from!: string;

  @IsString()
  to!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsString()
  outside_hours_message!: string;
}

export class UpdateEducationSlaDayDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day!: number;

  @IsString()
  from!: string;

  @IsString()
  to!: string;
}

export class UpdateEducationSlaDto {
  @IsInt()
  @Min(5)
  @Max(60)
  target_minutes!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateEducationSlaDayDto)
  days!: UpdateEducationSlaDayDto[];
}
