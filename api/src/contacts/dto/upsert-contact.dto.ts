import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  last_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  phone_prefix?: string;

  @IsOptional()
  @IsString()
  phone_local?: string;

  @IsArray()
  @IsString({ each: true })
  segments!: string[];

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}
