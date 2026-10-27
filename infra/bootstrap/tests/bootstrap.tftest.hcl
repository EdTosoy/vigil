# Mocked-provider, plan-only tests. No AWS credentials or API calls.
mock_provider "aws" {
  mock_data "aws_budgets_budget" {
    defaults = {
      budget_type      = "COST"
      time_unit        = "MONTHLY"
      budget_limit     = [{ amount = "5", unit = "USD" }]
      cost_types       = [{ include_credit = false, include_refund = false, include_tax = true }]
      cost_filter      = []
      billing_view_arn = ""
    }
  }
}
run "seed_security_boundaries" {
  command = plan
  assert {
    condition     = aws_s3_bucket.state.bucket == "flow-demo-tfstate-747240980964-ap-southeast-2"
    error_message = "State bucket must be new-account and Sydney scoped."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.state.block_public_acls && aws_s3_bucket_public_access_block.state.block_public_policy && aws_s3_bucket_public_access_block.state.ignore_public_acls && aws_s3_bucket_public_access_block.state.restrict_public_buckets
    error_message = "State must never be publicly accessible."
  }
  assert {
    condition     = one(aws_s3_bucket_versioning.state.versioning_configuration).status == "Enabled" && one(one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    error_message = "State must be encrypted and versioned."
  }
  assert {
    condition     = alltrue([for repository in aws_ecr_repository.image : repository.image_tag_mutability == "IMMUTABLE" && !repository.force_delete])
    error_message = "Deployment images must retain immutable identities."
  }
  assert {
    condition     = data.aws_budgets_budget.existing.name == "mdp-monthly-gross-usd-5" && data.aws_budgets_budget.existing.account_id == "747240980964"
    error_message = "Budget is only a read-only reference to the existing new-account gross budget."
  }
}
run "historical_account_refused" {
  command = plan
  variables { aws_account_id = "163596511125" }
  expect_failures = [var.aws_account_id]
}
run "historical_profile_refused" {
  command = plan
  variables { aws_profile = "iamadmin-general" }
  expect_failures = [var.aws_profile]
}
run "historical_region_refused" {
  command = plan
  variables { aws_region = "us-east-1" }
  expect_failures = [var.aws_region]
}
run "foreign_budget_refused" {
  command = plan
  variables { existing_budget_name = "flow-demo-account-monthly" }
  expect_failures = [var.existing_budget_name]
}
run "net_after_credit_budget_refused" {
  command = plan
  override_data {
    target = data.aws_budgets_budget.existing
    values = {
      budget_type  = "COST", time_unit = "MONTHLY"
      budget_limit = [{ amount = "5", unit = "USD" }]
      cost_types   = [{ include_credit = true, include_refund = false, include_tax = true }]
      cost_filter  = [], billing_view_arn = ""
    }
  }
  expect_failures = [data.aws_budgets_budget.existing]
}
run "wrong_budget_amount_refused" {
  command = plan
  override_data {
    target = data.aws_budgets_budget.existing
    values = {
      budget_type  = "COST", time_unit = "MONTHLY"
      budget_limit = [{ amount = "10", unit = "USD" }]
      cost_types   = [{ include_credit = false, include_refund = false, include_tax = true }]
      cost_filter  = [], billing_view_arn = ""
    }
  }
  expect_failures = [data.aws_budgets_budget.existing]
}
