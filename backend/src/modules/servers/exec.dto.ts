import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** who's allowed to open a shell is decided at connect; this only shapes input */
export class ExecInputDto {
  @IsString()
  @MaxLength(6000)
  data!: string;
}

export class ExecResizeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  cols?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  rows?: number;
}
