import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ROLE_SLUGS } from '../../auth/roles';
import { BUSINESS_AREAS } from '../../config/areas';

const ROLE_SLUG_VALUES = [...ROLE_SLUGS];

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsString()
  @IsIn([...BUSINESS_AREAS])
  area!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @IsIn(ROLE_SLUG_VALUES)
  role_slug?: string | null;

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
  @IsBoolean()
  can_assign_conversations?: boolean;

  @IsOptional()
  @IsBoolean()
  can_manage_attributes?: boolean;

  @IsOptional()
  @IsBoolean()
  can_manage_segments?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_conversation_stats?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_campaign_stats?: boolean;

  @IsOptional()
  @IsBoolean()
  can_manage_leads?: boolean;

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
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @IsIn(ROLE_SLUG_VALUES)
  role_slug?: string | null;

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
  @IsBoolean()
  can_assign_conversations?: boolean;

  @IsOptional()
  @IsBoolean()
  can_manage_attributes?: boolean;

  @IsOptional()
  @IsBoolean()
  can_manage_segments?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_conversation_stats?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_campaign_stats?: boolean;

  @IsOptional()
  @IsBoolean()
  can_manage_leads?: boolean;

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
