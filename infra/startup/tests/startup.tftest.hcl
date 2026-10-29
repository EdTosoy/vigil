mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "747240980964", arn = "arn:aws:sts::747240980964:assumed-role/AccountFullAccessRole/offline-test" }
  }
  mock_data "aws_subnet" {
    defaults = { id = "subnet-00000000000000001", vpc_id = "vpc-00000000000000001", owner_id = "747240980964", availability_zone = "ap-southeast-2a" }
  }
  mock_data "aws_route_table" {
    defaults = { routes = [{ cidr_block = "0.0.0.0/0", gateway_id = "igw-00000000000000001" }] }
  }
  mock_data "aws_ami" {
    defaults = { id = "ami-00000000000000001", architecture = "arm64" }
  }
  mock_resource "aws_ebs_volume" {
    defaults = { id = "vol-00000000000000001" }
  }
}
variables {
  ami_id           = "ami-00000000000000001"
  vpc_id           = "vpc-00000000000000001"
  public_subnet_id = "subnet-00000000000000001"
  acme_email       = "operator@example.com"
  images = {
    ops    = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/ops@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    stripe = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/stripe@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    admin  = "747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/admin@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
run "single_arm64_host_with_private_persistent_storage" {
  command = plan
  assert {
    condition     = aws_instance.host.instance_type == "t4g.medium" && aws_instance.host.metadata_options[0].http_tokens == "required" && aws_instance.host.metadata_options[0].http_put_response_hop_limit == 1 && aws_instance.host.credit_specification[0].cpu_credits == "standard"
    error_message = "Only t4g.medium; host-only IMDSv2; no surplus-credit billing."
  }
  assert {
    condition     = aws_ebs_volume.data.encrypted && aws_ebs_volume.data.type == "gp3" && aws_ebs_volume.data.size == 40 && aws_instance.host.root_block_device[0].encrypted
    error_message = "Persistent data and root storage must be encrypted."
  }
  assert {
    condition     = length(aws_security_group.host.ingress) == 2 && alltrue([for rule in aws_security_group.host.ingress : contains([80, 443], rule.from_port) && rule.to_port == rule.from_port && rule.protocol == "tcp"])
    error_message = "Only Caddy HTTP(S) may be public; SSH and PostgreSQL must remain closed."
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.host.policy).Statement[2].Resource) == 6 && jsondecode(aws_iam_role_policy.host.policy).Statement[2].Action == ["ssm:GetParameter"]
    error_message = "Secrets access must stay restricted to six startup parameters."
  }
}
run "reject_wrong_caller" {
  command = plan
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "747240980964", arn = "arn:aws:iam::747240980964:root" }
  }
  expect_failures = [data.aws_caller_identity.current]
}
run "reject_floating_or_foreign_images" {
  command = plan
  variables {
    images = { ops = "flow-demo/ops:latest", stripe = "flow-demo/stripe:latest", admin = "flow-demo/admin:latest" }
  }
  expect_failures = [var.images]
}
run "reject_private_subnet" {
  command = plan
  override_data {
    target = data.aws_route_table.public
    values = { routes = [] }
  }
  expect_failures = [data.aws_route_table.public]
}
