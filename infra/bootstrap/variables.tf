variable "existing_budget_name" {
  description = "Read-only reference to the already existing account-wide gross budget; never owned by Vigil."
  type        = string
  default     = "mdp-monthly-gross-usd-5"
  validation {
    condition     = var.existing_budget_name == "mdp-monthly-gross-usd-5"
    error_message = "Use the existing five-dollar gross account budget."
  }
}
