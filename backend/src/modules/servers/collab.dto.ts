import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/** Invite someone to a server by the email on their account. */
export class AddSubuserDto {
  @IsString()
  @MaxLength(255)
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Enter a valid email address' })
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  permissions!: string[];
}

/** Replace the whole permission set (the UI always sends the full list). */
export class UpdateSubuserDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  permissions!: string[];
}

export class CreateScheduleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  /** 5-field cron, evaluated in UTC. Validated against the platform parser. */
  @IsString()
  @MaxLength(64)
  cron!: string;

  @IsIn(['backup', 'start', 'stop', 'restart'])
  action!: 'backup' | 'start' | 'stop' | 'restart';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cron?: string;

  @IsOptional()
  @IsIn(['backup', 'start', 'stop', 'restart'])
  action?: 'backup' | 'start' | 'stop' | 'restart';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class PreviewCronDto {
  @IsString()
  @MaxLength(64)
  cron!: string;

  @IsOptional()
  @IsUUID('4')
  excludeId?: string;
}
