import { IsString } from 'class-validator';

export class SwitchAreaDto {
  @IsString()
  area!: string;
}
