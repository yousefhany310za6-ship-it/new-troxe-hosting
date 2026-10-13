import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Complete a renewal with the key Work.ink handed back.
 *
 * The key is the ONLY body field. There is deliberately no `hours`,
 * `newExpiresAt` or `serverId`: the duration, the target server and the clock
 * are all resolved server-side, so a client cannot ask for a longer extension
 * or apply one attempt to a different server.
 */
export class CompleteRenewalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;
}

/** The Work.ink return landing page reads its inputs from the query string. */
export class RenewalCallbackQueryDto {
  /**
   * Session id. It is NOT authentication — the completion endpoint still
   * requires the caller to own the session — it exists so the landing page can
   * show the right copy without a second round trip.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  session?: string;

  /** The key Work.ink substituted into the return URL. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  key?: string;
}