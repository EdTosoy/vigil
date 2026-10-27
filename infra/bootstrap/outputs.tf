output "state_bucket" {
  description = "Encrypted/versioned state bucket; use separate bootstrap and demo keys."
  value       = aws_s3_bucket.state.id
}

output "image_repositories" {
  value = { for name, repository in aws_ecr_repository.image : name => repository.repository_url }
}

output "budget_name" {
  description = "Read-only observed name; no management or notification-delivery claim."
  value       = data.aws_budgets_budget.existing.name
}
