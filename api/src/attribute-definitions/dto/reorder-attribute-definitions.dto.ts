import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class ReorderAttributeDefinitionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  orderedIds!: number[];
}
