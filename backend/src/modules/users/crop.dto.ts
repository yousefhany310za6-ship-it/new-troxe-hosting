import { IsInt, Max, Min } from 'class-validator';

/**
 * Crop rectangle for avatar re-crop. Pixels relative to the stored,
 * orientation-normalized original. Validated server-side — the client
 * cannot send arbitrary values.
 */
export class CropRectDto {
  @IsInt()
  @Min(0)
  x!: number;

  @IsInt()
  @Min(0)
  y!: number;

  @IsInt()
  @Min(1)
  @Max(8192)
  size!: number;
}
