variable "images" {
  type        = map(string)
  description = "Reviewed immutable ECR image digests for ops, stripe and admin."
  validation {
    condition     = length(var.images) == 3 && alltrue([for name in ["ops", "stripe", "admin"] : can(regex("^747240980964\\.dkr\\.ecr\\.ap-southeast-2\\.amazonaws\\.com/flow-demo/${name}@sha256:[0-9a-f]{64}$", var.images[name]))])
    error_message = "Use three approved-account immutable image digests."
  }

}
variable "secrets" {
  type        = map(string)
  sensitive   = true
  ephemeral   = true
  description = "In-memory/write-only values. Never persisted in a Terraform plan or state."
}
variable "secrets_version" {
  type    = number
  default = 1
}
variable "stripe_account_id" {
  type = string
  validation {
    condition     = can(regex("^acct_[A-Za-z0-9]+$", var.stripe_account_id))
    error_message = "An explicit sandbox account is required."
  }

}
variable "stripe_source_id" {
  type    = string
  default = ""
}
variable "ops_book_id" {
  type    = string
  default = ""
}
variable "start_services" {
  type    = bool
  default = false
}

variable "availability_zones" {
  description = "Two distinct Sydney zones; D2 must confirm account availability before planning."
  type        = list(string)
  default     = ["ap-southeast-2a", "ap-southeast-2b"]
  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2 && alltrue([for zone in var.availability_zones : contains(["ap-southeast-2a", "ap-southeast-2b", "ap-southeast-2c"], zone)])
    error_message = "Use two distinct approved Sydney availability zones."
  }
}
variable "hostname" {
  description = "Planned Cloudflare-managed hostname; no DNS changes are performed by Terraform."
  type        = string
  default     = "vigil.edtosoy.com"
  validation {
    condition     = var.hostname == "vigil.edtosoy.com"
    error_message = "Only vigil.edtosoy.com is approved; never modify flow.edtosoy.com."
  }
}
variable "certificate_dns_confirmed" {
  description = "Manual STOP: operator must publish ACM CNAMEs and verify public DNS before enabling the validation waiter/HTTPS listeners."
  type        = bool
  default     = false
}
