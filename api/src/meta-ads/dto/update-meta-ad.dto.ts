import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMetaAdDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  display_name?: string;
}
