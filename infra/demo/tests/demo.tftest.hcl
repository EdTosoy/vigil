mock_provider "aws" {
  override_during = plan
  mock_resource "aws_security_group" {
    defaults        = { id = "sg-00000000000000001" }
    override_during = plan
  }
  mock_resource "aws_ssm_parameter" {
    defaults        = { arn = "arn:aws:ssm:ap-southeast-2:747240980964:parameter/mock-only" }
    override_during = plan
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults        = { arn = "arn:aws:logs:ap-southeast-2:747240980964:log-group:mock-only" }
    override_during = plan
  }
}
variables {
  images = {
    ops    = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/ops@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    stripe = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/stripe@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    admin  = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/admin@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  stripe_account_id = "acct_test"
  secrets = {
    admin_password      = "test-not-a-real-password", provisioning = "{}", stripe_key = "test-not-a-real-key"
    webhook_secrets     = "pending", demo_username = "demo", demo_password = "test-not-a-real-password"
    operations_password = "test-not-a-real-password", ingress_password = "test-not-a-real-password", stripeworker_password = "test-not-a-real-password"
  }
}
run "private_disposable_database_and_disabled_services" {
  command = plan
  assert {
    condition     = !aws_db_instance.demo.publicly_accessible && !aws_db_instance.demo.multi_az && aws_db_instance.demo.storage_encrypted && aws_db_instance.demo.skip_final_snapshot && !aws_db_instance.demo.deletion_protection && aws_db_instance.demo.backup_retention_period == 0
    error_message = "Database must be private, encrypted, Single-AZ and disposable."
  }
  assert {
    condition     = length(aws_ecs_service.app) == 0 && alltrue([for p in aws_ssm_parameter.runtime : p.type == "SecureString"])
    error_message = "Provision secrets and capabilities before enabling services."
  }
  assert {
    condition     = length(aws_subnet.public) == 2 && length(aws_subnet.database) == 2 && length(aws_vpc_security_group_ingress_rule.postgres) == 5 && length(aws_vpc_security_group_ingress_rule.app) == 2
    error_message = "Only approved task boundaries may reach the private database and ALB applications."
  }
}
run "initial_plan_needs_only_owner_password_and_no_future_bindings" {
  command = plan
  variables {
    initial_infrastructure_only = true
    defer_webhook_secret        = true
    secrets                     = { admin_password = "test-only-owner-password" }
  }
  assert {
    condition     = length(aws_ssm_parameter.runtime) == 1 && aws_ssm_parameter.runtime["admin_url"].name == "/flow/demo/admin_url" && length(aws_ecs_service.app) == 0 && length(aws_lb_listener.https) == 0
    error_message = "Initial plan needs no dummy webhook, provisioning, endpoint or source/book values."
  }
  assert {
    condition     = alltrue([for task in aws_ecs_task_definition.app : alltrue([for secret in jsondecode(task.container_definitions)[0].secrets : startswith(secret.valueFrom, "arn:aws:ssm:ap-southeast-2:747240980964:parameter/flow/demo/")])])
    error_message = "Deferred parameters must retain exact private ARN references, never literal credentials."
  }
}
run "initial_stage_cannot_activate_even_with_uuid_syntax_and_dns_flag" {
  command = plan
  variables {
    initial_infrastructure_only = true
    secrets                     = { admin_password = "test-only-owner-password" }
    start_services              = true
    certificate_dns_confirmed   = true
    stripe_source_id            = "11111111-1111-4111-8111-111111111111"
    ops_book_id                 = "22222222-2222-4222-8222-222222222222"
  }
  expect_failures = [aws_ecs_task_definition.app]
}
run "provisioning_stage_needs_no_hosted_signing_secret" {
  command = plan
  variables {
    defer_webhook_secret = true
    secrets = {
      admin_password      = "test-not-a-real-password", provisioning = "{}", stripe_key = "test-not-a-real-key"
      demo_username       = "demo", demo_password = "test-not-a-real-password"
      operations_password = "test-not-a-real-password", ingress_password = "test-not-a-real-password", stripeworker_password = "test-not-a-real-password"
    }
  }
  assert {
    condition     = length(aws_ssm_parameter.runtime) == 8 && !contains(keys(aws_ssm_parameter.runtime), "webhook_secrets") && length(aws_ecs_service.app) == 0
    error_message = "Migrations/provisioning precede webhook registration without fake signing credentials."
  }
}
run "deferred_webhook_stage_cannot_activate" {
  command = plan
  variables {
    defer_webhook_secret      = true
    start_services            = true
    certificate_dns_confirmed = true
    stripe_source_id          = "11111111-1111-4111-8111-111111111111"
    ops_book_id               = "22222222-2222-4222-8222-222222222222"
  }
  expect_failures = [aws_ecs_task_definition.app]
}
run "fail_closed_before_scope_provisioning" {
  command = plan
  variables { start_services = true }
  expect_failures = [aws_ecs_task_definition.app]
}

run "sydney_network_tls_and_execution_boundaries" {
  command = plan
  assert {
    condition     = alltrue([for subnet in concat(aws_subnet.public, aws_subnet.database) : startswith(subnet.availability_zone, "ap-southeast-2")]) && aws_route.internet.destination_cidr_block == "0.0.0.0/0"
    error_message = "Only Sydney zones; public tasks use the internet gateway for outbound HTTPS."
  }
  assert {
    condition     = alltrue([for rule in aws_vpc_security_group_egress_rule.task_https : rule.from_port == 443 && rule.to_port == 443]) && alltrue([for rule in aws_vpc_security_group_ingress_rule.postgres : rule.from_port == 5432 && rule.referenced_security_group_id != null])
    error_message = "Task HTTPS egress does not authorize public DB ingress."
  }
  assert {
    condition     = aws_db_instance.demo.engine_version == "18.6" && aws_db_instance.demo.instance_class == "db.t4g.micro" && aws_db_instance.demo.allocated_storage == 20 && aws_db_instance.demo.storage_type == "gp3" && aws_db_instance.demo.ca_cert_identifier == "rds-ca-rsa2048-g1" && one(aws_db_parameter_group.demo.parameter).value == "1"
    error_message = "Retain the known disposable PostgreSQL/TLS configuration."
  }
  assert {
    condition     = alltrue([for task in aws_ecs_task_definition.app : one(task.runtime_platform).cpu_architecture == "X86_64" && task.cpu == "256" && jsondecode(task.container_definitions)[0].logConfiguration.options["awslogs-region"] == "ap-southeast-2"])
    error_message = "Fargate remains compatible with locally built linux/amd64 images and Sydney logs."
  }
  assert {
    condition     = alltrue([for role in aws_iam_role.execution : jsondecode(role.assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == "747240980964" && jsondecode(role.assume_role_policy).Statement[0].Condition.ArnLike["aws:SourceArn"] == "arn:aws:ecs:ap-southeast-2:747240980964:*"])
    error_message = "Trust policies must never use historical account or region."
  }
  assert {
    condition     = aws_acm_certificate.demo.domain_name == "vigil.edtosoy.com" && length(aws_acm_certificate_validation.demo) == 0 && length(aws_lb_listener.https) == 0
    error_message = "Manual Cloudflare DNS gate precedes certificate waiting and HTTPS startup."
  }
}
run "dns_confirmed_but_services_still_disabled" {
  command = plan
  variables { certificate_dns_confirmed = true }
  assert {
    condition     = length(aws_ecs_service.app) == 3 && alltrue([for service in aws_ecs_service.app : service.desired_count == 0 && one(service.network_configuration).assign_public_ip]) && length(aws_lb_listener.https) == 1
    error_message = "DNS confirmation alone must never start tasks."
  }
}
run "historical_account_refused" {
  command = plan
  variables { aws_account_id = "163596511125" }
  expect_failures = [var.aws_account_id]
}
run "historical_profile_refused" {
  command = plan
  variables { aws_profile = "iamadmin-general" }
  expect_failures = [var.aws_profile]
}
run "historical_region_refused" {
  command = plan
  variables { aws_region = "us-east-1" }
  expect_failures = [var.aws_region]
}
run "historical_zones_refused" {
  command = plan
  variables { availability_zones = ["us-east-1a", "us-east-1b"] }
  expect_failures = [var.availability_zones]
}
run "historical_hostname_refused" {
  command = plan
  variables { hostname = "flow.edtosoy.com" }
  expect_failures = [var.hostname]
}
run "historical_images_refused" {
  command = plan
  variables {
    images = {
      ops    = "163596511125.dkr.ecr.us-east-1.amazonaws.com/flow-demo/ops@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      stripe = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/stripe@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      admin  = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/admin@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
  expect_failures = [var.images]
}
run "wrong_repository_for_role_refused" {
  command = plan
  variables {
    images = {
      ops    = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/admin@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      stripe = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/stripe@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      admin  = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/admin@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
  expect_failures = [var.images]
}
