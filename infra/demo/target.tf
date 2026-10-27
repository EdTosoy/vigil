# Sydney is an exact target, not an arbitrary-account deployment interface.
variable "aws_account_id" {
  type    = string
  default = "747240980964"
  validation {
    condition     = var.aws_account_id == "747240980964"
    error_message = "Only Sydney account 747240980964 is approved."
  }
}
variable "aws_profile" {
  type    = string
  default = "edtosoy"
  validation {
    condition     = var.aws_profile == "edtosoy"
    error_message = "Explicit edtosoy profile required."
  }
}
variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
  validation {
    condition     = var.aws_region == "ap-southeast-2"
    error_message = "Only ap-southeast-2 is approved."
  }
}
