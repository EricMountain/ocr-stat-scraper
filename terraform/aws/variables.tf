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
  default     = "stat-scraper-api-keys"
}

variable "readings_table_name" {
  description = "DynamoDB readings table name"
  type        = string
  default     = "stat-scraper-readings"
}

variable "form_fields" {
  description = "List of form field definitions { name = string, type = string, plot = optional({ default = bool, style = string, unit = string }) }"
  type = list(object({
    name = string
    type = string # number | duration | boolean
    plot = optional(object({
      default = optional(bool)
      style   = optional(string) # bar | line | point
      unit    = optional(string)
    }))
  }))
  default = []
}
