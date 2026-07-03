import { ArrayMinSize, IsArray, IsInt, IsString, Min } from 'class-validator';

export class BulkAddSegmentDto {
  @IsString()
  segment_slug!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  contact_ids!: number[];
}
