import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const FLOW_STATUSES = ['draft', 'active', 'paused'] as const;
const NODE_KINDS = [
  'message_text',
  'message_buttons',
  'handoff_human',
  'end',
] as const;

export class FlowButtonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  title!: string;
}

export class FlowNodeInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  client_key!: string;

  @IsIn(NODE_KINDS)
  kind!: (typeof NODE_KINDS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  body_text?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowButtonDto)
  buttons?: FlowButtonDto[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1440)
  @Type(() => Number)
  timeout_minutes?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  timeout_body_text?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsNumber()
  position_x?: number;

  @IsOptional()
  @IsNumber()
  position_y?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Type(() => Number)
  handoff_user_id?: number | null;
}

export class FlowEdgeInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  from_client_key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  to_client_key!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  match_payload?: string | null;
}

export class CreateFlowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  trigger_payload!: string;

  @IsOptional()
  @IsIn(FLOW_STATUSES)
  status?: (typeof FLOW_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entry_client_key?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodeInputDto)
  nodes!: FlowNodeInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowEdgeInputDto)
  edges?: FlowEdgeInputDto[];
}

export class UpdateFlowDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  trigger_payload?: string;

  @IsOptional()
  @IsIn(FLOW_STATUSES)
  status?: (typeof FLOW_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entry_client_key?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodeInputDto)
  nodes?: FlowNodeInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowEdgeInputDto)
  edges?: FlowEdgeInputDto[];
}
