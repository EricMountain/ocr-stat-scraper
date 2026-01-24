# Package Lambda from local source
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda"
  output_path = "${path.module}/lambda.zip"
}

# IAM role and policies
resource "aws_iam_role" "lambda" {
  name               = "${var.lambda_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "lambda_logs" {
  name   = "${var.lambda_name}-logs"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name   = "${var.lambda_name}-dynamodb"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_dynamodb.json
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

data "aws_iam_policy_document" "lambda_logs" {
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

data "aws_iam_policy_document" "lambda_dynamodb" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      aws_dynamodb_table.api_keys.arn,
      "${aws_dynamodb_table.api_keys.arn}/*",
      aws_dynamodb_table.readings.arn,
      "${aws_dynamodb_table.readings.arn}/*",
    ]
  }
}

# Logging
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.lambda_name}"
  retention_in_days = var.log_retention_days
}

# Lambda function and URL
resource "aws_lambda_function" "stat_scraper" {
  function_name    = var.lambda_name
  role             = aws_iam_role.lambda.arn
  handler          = "handler.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  publish          = true

  environment {
    variables = {
      DYNAMO_TABLE   = aws_dynamodb_table.api_keys.name
      READINGS_TABLE = aws_dynamodb_table.readings.name
      DYNAMO_GSI     = "device_id-index"
      DYNAMO_REGION  = var.aws_region
      FORM_FIELDS    = jsonencode(var.form_fields)
    }
  }
}

resource "aws_lambda_function_url" "stat_scraper" {
  function_name      = aws_lambda_function.stat_scraper.arn
  authorization_type = "NONE"

  cors {
    allow_credentials = true
    allow_headers     = ["content-type", "x-api-key"]
    allow_methods     = ["GET", "POST"]
    allow_origins     = ["*"]
  }
}

output "function_url" {
  value = aws_lambda_function_url.stat_scraper.function_url
}

output "lambda_name" {
  value = aws_lambda_function.stat_scraper.function_name
}

output "role_name" {
  value = aws_iam_role.lambda.name
}
