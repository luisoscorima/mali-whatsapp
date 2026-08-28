import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CrmSendTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  area?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  template_name!: string;

  /** Evita reenvío (ej. PamRegistration.id). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotency_key?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  body_params?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  header_params?: string[];
}
