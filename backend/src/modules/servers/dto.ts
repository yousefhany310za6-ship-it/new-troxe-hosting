import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { config } from '../../config/env';
import { RUNTIMES } from './provisioning/images';

export { RUNTIMES };

export class EnvVarDto {
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Za-z_][A-Za-z0-9_]*$/, { message: 'env key invalid' })
  k!: string;

  @MaxLength(5000)
  v!: string;
}

export class CreateServerDto {
  @Matches(/^[a-z0-9-]{3,32}$/, { message: 'name must be 3-32 lowercase letters/digits/dashes' })
  name!: string;

  @IsIn(RUNTIMES as unknown as string[], { message: 'RUNTIME_UNSUPPORTED' })
  runtime!: (typeof RUNTIMES)[number];

  /** version selector, e.g. '22' — must exist for the runtime (default: first) */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  version?: string;

  @IsOptional()
  @IsIn([...config.REGIONS], { message: 'REGION_UNSUPPORTED' })
  region?: string;

  // NOTE: no planId here on purpose — the plan is taken from the user's
  // server-side assignment, never from the request body (quota escalation).

  @IsOptional()
  @MinLength(1)
  @MaxLength(500)
  startup?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EnvVarDto)
  env?: EnvVarDto[];

  @IsOptional() @IsBoolean() autoRestart?: boolean;
  @IsOptional() @IsBoolean() autoBackup?: boolean;
}

export class UpdateServerDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,32}$/, { message: 'name must be 3-32 lowercase letters/digits/dashes' })
  name?: string;

  @IsOptional()
  @MinLength(1)
  @MaxLength(500)
  startup?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EnvVarDto)
  env?: EnvVarDto[];

  @IsOptional() @IsBoolean() autoRestart?: boolean;
  @IsOptional() @IsBoolean() autoBackup?: boolean;
}
