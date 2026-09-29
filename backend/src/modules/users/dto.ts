import { IsBoolean, IsEmail, IsOptional, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @MinLength(3)
  @MaxLength(30)
  name!: string;

  @IsEmail()
  email!: string;
}

export class UpdatePasswordDto {
  @MinLength(1)
  current!: string;

  @MinLength(8)
  next!: string;

  @MinLength(8)
  confirm!: string;
}

export class UpdateNotificationsDto {
  @IsOptional() @IsBoolean() restarts?: boolean;
  @IsOptional() @IsBoolean() invoices?: boolean;
  @IsOptional() @IsBoolean() marketing?: boolean;
}
