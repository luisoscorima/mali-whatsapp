import { ArrayMinSize, IsArray, IsInt, IsString, Min } from 'class-validator';

export class BulkSetAttributeDto {
  @IsString()
  attr_key!: string;

  @IsString()
  attr_value!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  contact_ids!: number[];
}
