# DynamoDB table for API keys and device mapping
resource "aws_dynamodb_table" "api_keys" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "api_key"

  attribute {
    name = "api_key"
    type = "S"
  }

  attribute {
    name = "device_id"
    type = "S"
  }

  global_secondary_index {
    name            = "device_id-index"
    hash_key        = "device_id"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = var.table_name
  }
}

# DynamoDB table for device readings
resource "aws_dynamodb_table" "readings" {
  name         = var.readings_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "device_id"
  range_key    = "reading_ts"

  attribute {
    name = "device_id"
    type = "S"
  }

  attribute {
    name = "reading_ts"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = var.readings_table_name
  }
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.api_keys.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.api_keys.arn
}

output "dynamodb_readings_table_name" {
  value = aws_dynamodb_table.readings.name
}

output "dynamodb_readings_table_arn" {
  value = aws_dynamodb_table.readings.arn
}
