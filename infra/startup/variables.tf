variable "ami_id" {
  description = "Reviewed Canonical Ubuntu 24.04 ARM64 AMI in Sydney; pin its ID."
  type        = string
  validation {
    condition     = can(regex("^ami-[0-9a-f]{17}$", var.ami_id))
    error_message = "A pinned AMI ID is required."
  }
}
variable "vpc_id" { type = string }
variable "public_subnet_id" { type = string }
variable "domain" {
  type    = string
  default = "vigil.edtosoy.com"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.domain))
    error_message = "Use a DNS hostname, without a scheme or path."
  }
}
variable "acme_email" {
  type = string
  validation {
    condition     = can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", var.acme_email))
    error_message = "An ACME contact email is required."
  }
}
variable "images" {
  description = "Fresh linux/arm64 images in the three EXISTING ECR repositories."
  type        = object({ ops = string, stripe = string, admin = string })
  validation {
    condition = alltrue([for name, image in var.images : can(regex(
      "^747240980964\\.dkr\\.ecr\\.ap-southeast-2\\.amazonaws\\.com/flow-demo/${name}@sha256:[0-9a-f]{64}$", image
    ))])
    error_message = "Only digest-pinned images from the existing Sydney ECR repositories are accepted."
  }
}
variable "data_volume_gib" {
  type    = number
  default = 40
  validation {
    condition     = var.data_volume_gib >= 40 && var.data_volume_gib <= 200 && floor(var.data_volume_gib) == var.data_volume_gib
    error_message = "Use 40–200 GiB; EBS cannot be shrunk."
  }
}
