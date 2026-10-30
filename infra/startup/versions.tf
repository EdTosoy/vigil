terraform {
  required_version = "= 1.15.3"
  required_providers {
    aws = { source = "hashicorp/aws", version = "6.68.0" }
  }
  backend "s3" {
    bucket              = "flow-demo-tfstate-747240980964-ap-southeast-2"
    key                 = "startup/terraform.tfstate"
    region              = "ap-southeast-2"
    profile             = "edtosoy"
    allowed_account_ids = ["747240980964"]
    encrypt             = true
    use_lockfile        = true
  }
}
provider "aws" {
  region              = "ap-southeast-2"
  profile             = "edtosoy"
  allowed_account_ids = ["747240980964"]
  default_tags {
    tags = { Project = "vigil", Environment = "startup", ManagedBy = "terraform" }
  }
}
