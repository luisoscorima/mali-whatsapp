import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class ReorderSegmentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  orderedIds!: number[];
}
