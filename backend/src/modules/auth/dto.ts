import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @MinLength(3)
  @MaxLength(30)
  name!: string;

  @IsEmail()
  email!: string;

  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password must contain a letter and a number' })
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @MinLength(1)
  password!: string;
}
