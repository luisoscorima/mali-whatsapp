import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_SESSION_TEXT_LEN } from '../../settings/business-hours.util';

export class ReplyConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SESSION_TEXT_LEN)
  message?: string;

  @IsOptional()
  reply_to_message_id?: number | string;
}

export class MessageReactionDto {
  @IsString()
  @MaxLength(16)
  emoji!: string;
}

export class UpdateConversationModeDto {
  @IsString()
  @IsIn(['bot', 'human'])
  status!: 'bot' | 'human';
}

export class LeadScoreDto {
  @IsOptional()
  @IsString()
  lead_score?: string;

  @IsOptional()
  @IsString()
  lead_score_clear?: string;
}

export class AssignConversationDto {
  @IsOptional()
  assigned_user_id?: number | null;
}
