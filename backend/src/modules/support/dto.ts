import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import {
  DESCRIPTION_MAX,
  ESCALATION_REASON_MAX,
  MESSAGE_MAX,
  RATING_COMMENT_MAX,
  SUBJECT_MAX,
  TICKET_CATEGORIES,
} from './support-policy';

export class CreateTicketDto {
  @IsString()
  @MinLength(4)
  @MaxLength(SUBJECT_MAX)
  subject!: string;

  @IsIn(TICKET_CATEGORIES as unknown as string[])
  category!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(DESCRIPTION_MAX)
  description!: string;

  /**
   * Users may raise urgency but never claim "critical": that tier is staff-only
   * and drives support ordering.
   */
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  priority?: 'low' | 'medium' | 'high';

  /** public 8-digit server contact ID; resolved + ownership-checked server-side */
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'Server contact ID must be exactly 8 digits' })
  serverContactCode?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  body!: string;

  /** client-generated idempotency key: retries can never duplicate a message */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: 'Invalid idempotency key' })
  clientMsgId?: string;
}

export class SetStatusDto {
  @IsIn(['open', 'in_progress', 'waiting_user', 'waiting_admin', 'resolved', 'closed'])
  status!: 'open' | 'in_progress' | 'waiting_user' | 'waiting_admin' | 'resolved' | 'closed';
}

export class UpdateSubjectDto {
  @IsString()
  @MinLength(4)
  @MaxLength(SUBJECT_MAX)
  subject!: string;
}

export class EscalateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(ESCALATION_REASON_MAX)
  reason!: string;
}

export class AssignTicketDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { message: 'Invalid assignee id' })
  supportId!: string;
}

export class RateTicketDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsIn(['yes', 'partial', 'no'])
  resolved!: 'yes' | 'partial' | 'no';

  @IsOptional()
  @IsString()
  @MaxLength(RATING_COMMENT_MAX)
  comment?: string;
}

export class QueueQueryDto {
  @IsIn(['available', 'mine', 'waiting', 'escalated', 'resolved', 'all'])
  view!: 'available' | 'mine' | 'waiting' | 'escalated' | 'resolved' | 'all';

  @IsOptional()
  @IsIn(['open', 'in_progress', 'waiting_user', 'waiting_admin', 'resolved', 'closed'])
  status?: string;

  @IsOptional()
  @IsIn(TICKET_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  /** ticket number (#1234) or subject substring */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MyTicketsQueryDto {
  @IsOptional()
  @IsIn(['open', 'in_progress', 'waiting_user', 'waiting_admin', 'resolved', 'closed'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
