import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { AiTaskPriority, AiTaskStatus, AiWorkerStatus, ApprovalStatus, RiskLevel } from "@talenthub/database";

export class ApprovalPolicyDto {
  @ApiPropertyOptional({
    nullable: true,
    description: "Max amount the worker may act on without a human; null disables the amount rule",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  autoApproveMaxAmount?: number | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number;

  @ApiPropertyOptional({ enum: RiskLevel })
  @IsOptional()
  @IsEnum(RiskLevel)
  approvalRiskThreshold?: RiskLevel;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requireApprovalForTaskTypes?: string[];
}

export class HireWorkerDto {
  @ApiProperty({ example: "finance-clerk", description: "Role key from GET /workforce/catalog" })
  @IsString()
  roleKey!: string;

  @ApiPropertyOptional({ example: "Ava (Accounts Payable)" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: "Organization-specific instructions appended to the role prompt" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @ApiPropertyOptional({ type: ApprovalPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalPolicyDto)
  approvalPolicy?: ApprovalPolicyDto;
}

export class UpdateWorkerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(4000)
  instructions?: string | null;

  @ApiPropertyOptional({ type: ApprovalPolicyDto, description: "Merged onto the current policy" })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalPolicyDto)
  approvalPolicy?: ApprovalPolicyDto;
}

export class ListWorkersQueryDto {
  @ApiPropertyOptional({ enum: AiWorkerStatus })
  @IsOptional()
  @IsEnum(AiWorkerStatus)
  status?: AiWorkerStatus;
}

export class CreateTaskDto {
  @ApiProperty({ example: "process-invoice", description: "One of the worker role's task types" })
  @IsString()
  type!: string;

  @ApiProperty({ example: "Invoice #INV-2291 from Acme Supplies" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    example: { invoice: { number: "INV-2291", total: 840, currency: "USD" }, purchaseOrder: { number: "PO-77" } },
  })
  @IsObject()
  input!: Record<string, unknown>;

  @ApiPropertyOptional({ enum: AiTaskPriority, default: AiTaskPriority.NORMAL })
  @IsOptional()
  @IsEnum(AiTaskPriority)
  priority?: AiTaskPriority;

  @ApiPropertyOptional({ description: "Monetary value the task acts on; feeds the approval policy" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
}

export class CursorQueryDto {
  @ApiPropertyOptional({ description: "Cursor from the previous page's nextCursor" })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListTasksQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: AiTaskStatus })
  @IsOptional()
  @IsEnum(AiTaskStatus)
  status?: AiTaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workerId?: string;
}

export class ListApprovalsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ApprovalStatus, default: ApprovalStatus.PENDING })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;
}

export class DecideApprovalDto {
  @ApiPropertyOptional({ description: "Why the reviewer approved or rejected" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class MetricsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
