variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "eu-west-3"
}

variable "lambda_name" {
  description = "Lambda function name"
  type        = string
  default     = "ocr-stat-scraper"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 1
}

variable "table_name" {
  description = "DynamoDB table name"
  type        = string
  default     = "ocr-stat-scraper-api-keys"
}

variable "scan_patterns" {
  description = "List of regex patterns (strings) to scan incoming payload text"
  type        = list(string)
  default     = []
}
