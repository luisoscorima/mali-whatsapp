import { IsString, MaxLength } from 'class-validator';

export class SetAssignableSegmentDto {
  @IsString()
  @MaxLength(50)
  segment_slug!: string;
}
