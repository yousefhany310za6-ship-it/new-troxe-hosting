import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

const ID_RE = /^[a-z0-9-]{2,32}$/;
// hostname or IPv4 — never a URL (no scheme, no path, no port)
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const PEM_MIN = 20;

export class CreateNodeDto {
  /** optional custom id; generated (`node_<hex>`) when omitted */
  @IsOptional()
  @Matches(ID_RE, { message: 'id must be 2-32 lowercase letters/digits/dashes' })
  id?: string;

  @MinLength(2)
  @MaxLength(64)
  name!: string;

  @Matches(HOST_RE, { message: 'host must be a hostname or IP (no scheme, path or port)' })
  @MaxLength(253)
  host!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  /** PEM blocks — mutual TLS is mandatory for remote daemons, no exceptions */
  @IsString()
  @MinLength(PEM_MIN)
  @MaxLength(20000)
  ca!: string;

  @IsString()
  @MinLength(PEM_MIN)
  @MaxLength(20000)
  cert!: string;

  @IsString()
  @MinLength(PEM_MIN)
  @MaxLength(20000)
  key!: string;

  /**
   * Sandbox supernet (e.g. '10.201.0.0/16', mask 8-24) — REQUIRED for
   * remote nodes: the setup script installs it as static host firewall,
   * and the provisioner allocates sandbox /24s from it. Never overlaps
   * another node's base or docker defaults.
   */
  @Matches(/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(8|9|1\d|2[0-4])$/, {
    message: 'subnetBase must be a CIDR like 10.201.0.0/16 (mask 8-24)',
  })
  @MaxLength(18)
  subnetBase!: string;
}

export class UpdateNodeDto {
  @IsOptional()
  @MinLength(2)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @Matches(HOST_RE, { message: 'host must be a hostname or IP (no scheme, path or port)' })
  @MaxLength(253)
  host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  /** TLS trio is atomic: provide all three or none */
  @IsOptional()
  @IsString()
  @MinLength(PEM_MIN)
  @MaxLength(20000)
  ca?: string;

  @IsOptional()
  @IsString()
  @MinLength(PEM_MIN)
  @MaxLength(20000)
  cert?: string;

  @IsOptional()
  @IsString()
  @MinLength(PEM_MIN)
  @MaxLength(20000)
  key?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  drained?: boolean;

  /**
   * Sandbox supernet for static node firewalling (e.g. '10.201.0.0/16').
   * Null = legacy docker-assigned subnets (local node only).
   */
  @IsOptional()
  @Matches(/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(8|9|1\d|2[0-4])$/, {
    message: 'subnetBase must be a CIDR like 10.201.0.0/16 (mask 8-24)',
  })
  @MaxLength(18)
  subnetBase?: string | null;
}
