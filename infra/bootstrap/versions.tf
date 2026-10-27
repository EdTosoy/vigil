terraform {
  required_version = ">= 1.15.0, < 1.16.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.68.0"
    }
  }
  # Sources are assembled into a fresh target-scoped work root.
  # Initial bootstrap uses fresh LOCAL state; remote backend configuration
  # is introduced only after separately approved creation and lineage review.
}

provider "aws" {
  profile             = var.aws_profile
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = {
      Project           = "vigil"
      Environment       = "demo"
      Lifecycle         = "persistent"
      ManagedBy         = "terraform"
      DeploymentAccount = var.aws_account_id
      DeploymentRegion  = var.aws_region
    }
  }
}
