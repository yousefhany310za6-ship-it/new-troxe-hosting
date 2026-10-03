import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class OAuthLinkStartDto {
  @IsIn(['google', 'discord'])
  provider!: 'google' | 'discord';

  /** same-origin relative path to land on after login (validated server-side) */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  next?: string;
}

export class OAuthLinkConfirmDto {
  @IsString()
  @MaxLength(2048)
  linkToken!: string;
}
