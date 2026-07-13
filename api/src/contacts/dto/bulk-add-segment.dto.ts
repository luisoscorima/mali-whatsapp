import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class BulkAddSegmentDto {
  @IsString()
  segment_slug!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  contact_ids!: number[];

  /** Solo segmentos con assignable=true (inbox bulk). */
  @IsOptional()
  @IsBoolean()
  assignable_only?: boolean;
}
