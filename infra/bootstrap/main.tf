locals {
  bucket_name = "flow-demo-tfstate-${var.aws_account_id}-${var.aws_region}"
  images      = toset(["ops", "stripe", "admin"])
}

resource "aws_s3_bucket" "state" {
  bucket        = local.bucket_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      # Derive from the exact bucket input so the complete deny policy is
      # inspectable in a first-time plan before the bucket ARN is computed.
      Resource  = ["arn:aws:s3:::${local.bucket_name}", "arn:aws:s3:::${local.bucket_name}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# Stripe ingress and Stripe worker share a provider-adapter image with different
# commands. The admin image is for one-shot migrations/provisioning, never a service.
resource "aws_ecr_repository" "image" {
  for_each             = local.images
  name                 = "flow-demo/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  encryption_configuration { encryption_type = "AES256" }
  image_scanning_configuration { scan_on_push = true }
  lifecycle { prevent_destroy = true }
}

resource "aws_ecr_lifecycle_policy" "image" {
  for_each   = local.images
  repository = aws_ecr_repository.image[each.key].name
  # Keep tagged deployment images: deleting an image still referenced by a task
  # definition would prevent safe task replacement or reproducible re-apply.
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged build remnants after seven days"
      selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
      action       = { type = "expire" }
    }]
  })
}

# Existing account-wide budget belongs to its current owner. Never import,
# duplicate, update or destroy it from Vigil. This data source is a future read.
data "aws_budgets_budget" "existing" {
  account_id = var.aws_account_id
  name       = var.existing_budget_name
  lifecycle {
    postcondition {
      condition = try(
        self.budget_type == "COST" &&
        tonumber(self.budget_limit[0].amount) == 5 && self.budget_limit[0].unit == "USD" &&
        self.account_id == var.budget_evidence.account_id && self.name == var.budget_evidence.name &&
        (self.billing_view_arn == null || self.billing_view_arn == ""),
        false
      )
      error_message = "The live budget reference must agree with the separately validated gross-cost observation."
    }
  }
}
