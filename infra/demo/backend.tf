terraform {
  backend "s3" {
    bucket              = "flow-demo-tfstate-747240980964-ap-southeast-2"
    key                 = "demo/terraform.tfstate"
    region              = "ap-southeast-2"
    profile             = "edtosoy"
    allowed_account_ids = ["747240980964"]
    encrypt             = true
    use_lockfile        = true
  }
}
