import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { BUSINESS_AREAS } from '../../config/areas';

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsIn([...BUSINESS_AREAS])
  area!: string;

  @IsOptional()
  @IsBoolean()
  is_master?: boolean;

  @IsOptional()
  @IsBoolean()
  must_change_password?: boolean;

  @IsOptional()
  @IsBoolean()
  can_edit_ai_prompt?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_audit_logs?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_integration?: boolean;

  @IsOptional()
  @IsBoolean()
  can_edit_business_hours?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_reports?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  extra_areas?: string[];
}

export class UpdateAdminUserDto {
  @IsString()
  @IsIn([...BUSINESS_AREAS])
  area!: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsBoolean()
  is_master?: boolean;

  @IsOptional()
  @IsBoolean()
  must_change_password?: boolean;

  @IsOptional()
  @IsBoolean()
  can_edit_ai_prompt?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_audit_logs?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_integration?: boolean;

  @IsOptional()
  @IsBoolean()
  can_edit_business_hours?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_reports?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  extra_areas?: string[];
}

export class UpdateAdminMetaDto {
  @IsOptional()
  global?: { verify_token?: string; app_secret?: string };

  @IsOptional()
  areas?: Record<
    string,
    {
      whatsapp_token?: string;
      phone_number_id?: string;
      waba_id?: string;
    }
  >;
}
