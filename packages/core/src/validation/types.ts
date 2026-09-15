export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  type: string;
  objectId?: string;
  message: string;
}
