variable "existing_budget_name" {
  description = "Read-only reference to the already existing account-wide gross budget; never owned by Vigil."
  type        = string
  default     = "mdp-monthly-gross-usd-5"
  validation {
    condition     = var.existing_budget_name == "mdp-monthly-gross-usd-5"
    error_message = "Use the existing five-dollar gross account budget."
  }
}

# Provider 6.68.0 declares but does not populate period/cost_types/cost_filter.
# Require fresh, sanitized DescribeBudget evidence from the guarded planner;
# never accept an assumed default or weaken the gross-cost checks.
variable "budget_evidence" {
  description = "Fresh read-only DescribeBudget observation, frozen and hash-bound to the plan. No notification contacts or credentials."
  type = object({
    account_id   = string, name = string, budget_type = string, time_unit = string,
    budget_limit = list(object({ amount = string, unit = string })),
    cost_types   = list(object({ include_credit = bool, include_refund = bool, include_tax = bool })),
    cost_filter  = list(string), billing_view_arn = string, observed_at = string
  })
  validation {
    condition = try(
      var.budget_evidence.account_id == "747240980964" && var.budget_evidence.name == "mdp-monthly-gross-usd-5" &&
      var.budget_evidence.budget_type == "COST" && var.budget_evidence.time_unit == "MONTHLY" &&
      length(var.budget_evidence.budget_limit) == 1 && tonumber(var.budget_evidence.budget_limit[0].amount) == 5 && var.budget_evidence.budget_limit[0].unit == "USD" &&
      length(var.budget_evidence.cost_types) == 1 && !var.budget_evidence.cost_types[0].include_credit && !var.budget_evidence.cost_types[0].include_refund && var.budget_evidence.cost_types[0].include_tax &&
    length(var.budget_evidence.cost_filter) == 0 && var.budget_evidence.billing_view_arn == "" && can(formatdate("YYYY-MM-DD", var.budget_evidence.observed_at)), false)
    error_message = "Fresh gross account-wide monthly USD 5 budget evidence is required: no credits/refunds, tax included, no cost filter or alternative billing view."
  }
}
