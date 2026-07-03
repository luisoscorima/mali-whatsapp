import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_SESSION_TEXT_LEN } from '../../settings/business-hours.util';

export class ReplyConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SESSION_TEXT_LEN)
  message?: string;
}

export class UpdateConversationModeDto {
  @IsString()
  @IsIn(['bot', 'human'])
  status!: 'bot' | 'human';
}
