import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
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

  /**
   * Optional resource request. Omitted fields fall back to the plan's
   * per-server ceiling (or whatever the account pool still has free). These
   * coarse bounds are only the first line of defence — the exact ceilings are
   * resolved server-side from the owner's plan (resource-policy.ts), the one
   * place a client cannot influence.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(8000) cpuMilli?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(128) @Max(24576) ramMb?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) storageGb?: number;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  autoBackupRetain?: number;
}

/**
 * Change the allocation of an EXISTING server. CPU/RAM are applied by
 * rebuilding the container (the volume and every file survive); storage is a
 * quota row only and needs no rebuild.
 */
export class RescaleServerDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(8000) cpuMilli?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(128) @Max(24576) ramMb?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) storageGb?: number;

  /** admin only: accept a request above the owner's plan (platform maxima still apply) */
  @IsOptional() @IsBoolean() override?: boolean;
}

export class ChangeRuntimeDto {
  /** must be one of the platform runtimes — the image is then chosen by the
   *  backend from the allowlist, never taken from this request */
  @IsIn(RUNTIMES as unknown as string[], { message: 'RUNTIME_UNSUPPORTED' })
  runtime!: (typeof RUNTIMES)[number];

  /** version selector, e.g. '22' — must exist for the runtime */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  version?: string;

  /**
   * 'recommended' adopts the new runtime's startup command and drops its
   * mechanical variables; 'keep' leaves the user's values untouched. Either
   * way the response lists what would break, so nothing changes silently.
   */
  @IsOptional()
  @IsIn(['recommended', 'keep'])
  startupMode?: 'recommended' | 'keep';
}

export class UpdateServerDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,32}$/, { message: 'name must be 3-32 lowercase letters/digits/dashes' })
  name?: string;

  /**
   * Entry point, relative to the server root (e.g. `index.js`, `src/main.py`).
   * A first-class setting — separate from the startup command and from the
   * environment variables; the service mirrors it into MAIN_FILE so existing
   * startup templates keep working.
   */
  @IsOptional()
  @Matches(/^(?![.]{1,2}(\/|$))[^\\\r\n\t]{1,160}$/, {
    message: 'main file must be a relative path (no leading slash, no .., no control characters)',
  })
  mainFile?: string;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  autoBackupRetain?: number;
}
