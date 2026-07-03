import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  language!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsObject()
  builder!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  source_template_id?: number;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsObject()
  builder!: Record<string, unknown>;
}

export class ValidateTemplateDto {
  @IsObject()
  builder!: Record<string, unknown>;
}
