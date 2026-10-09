import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Audience: all eligible users, plan slice, or explicit user list. */
export class AudienceDto {
  @IsIn(['all', 'plans', 'users'])
  type!: 'all' | 'plans' | 'users';

  @ValidateIf((o: AudienceDto) => o.type === 'plans')
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  plans?: string[];

  @ValidateIf((o: AudienceDto) => o.type === 'users')
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  userIds?: string[];
}

const KIND = ['info', 'success', 'warning', 'critical'] as const;
const STATUS = ['draft', 'scheduled', 'published', 'paused', 'archived'] as const;
const POLICY = ['once', 'every_visit', 'interval', 'until_ack'] as const;

export class CreateAnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name!: string;

  @IsString() @MinLength(1) @MaxLength(140)
  title!: string;

  @IsString() @MinLength(1) @MaxLength(4000)
  body!: string;

  @IsOptional() @IsIn(KIND as unknown as string[])
  kind?: (typeof KIND)[number];

  @IsOptional() @IsIn(POLICY as unknown as string[])
  policy?: (typeof POLICY)[number];

  @IsOptional() @IsBoolean()
  requireAck?: boolean;

  @ValidateIf((o: CreateAnnouncementDto) => o.policy === 'interval')
  @IsInt() @Min(1) @Max(24 * 90)
  intervalHours?: number;

  @IsOptional() @ValidateNested() @Type(() => AudienceDto)
  audience?: AudienceDto;

  @IsOptional() @IsString() @MaxLength(40)
  actionLabel?: string;

  @ValidateIf((o: CreateAnnouncementDto) => !!o.actionUrl)
  @IsString() @MaxLength(500)
  @Matches(/^(?!javascript:|data:|vbscript:|file:)[^\s<>]+$/i, { message: 'ACTION_URL_INVALID' })
  actionUrl?: string;

  @IsOptional() @Type(() => Date)
  eventStart?: Date;

  @IsOptional() @Type(() => Date)
  eventEnd?: Date;

  @IsOptional() @Type(() => Date)
  publishAt?: Date;

  @IsOptional() @Type(() => Date)
  expiresAt?: Date;
}

export class UpdateAnnouncementDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  name?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(140)
  title?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000)
  body?: string;

  @IsOptional() @IsIn(KIND as unknown as string[])
  kind?: (typeof KIND)[number];

  @IsOptional() @IsIn(POLICY as unknown as string[])
  policy?: (typeof POLICY)[number];

  @IsOptional() @IsBoolean()
  requireAck?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(24 * 90)
  intervalHours?: number;

  @IsOptional() @ValidateNested() @Type(() => AudienceDto)
  audience?: AudienceDto;

  @IsOptional() @IsString() @MaxLength(40)
  actionLabel?: string;

  @IsOptional() @IsString() @MaxLength(500)
  @Matches(/^(?!javascript:|data:|vbscript:|file:)[^\s<>]+$/i, { message: 'ACTION_URL_INVALID' })
  actionUrl?: string;

  @IsOptional() @Type(() => Date)
  eventStart?: Date;

  @IsOptional() @Type(() => Date)
  eventEnd?: Date;

  @IsOptional() @Type(() => Date)
  publishAt?: Date;

  @IsOptional() @Type(() => Date)
  expiresAt?: Date;
}

export class AnnouncementListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsIn([...STATUS, 'active'] as unknown as string[])
  status?: string;
}

export class ScheduleAnnouncementDto {
  @Type(() => Date)
  publishAt!: Date;
}
