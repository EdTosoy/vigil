data "aws_caller_identity" "current" {
  lifecycle {
    postcondition {
      condition     = self.account_id == "747240980964" && can(regex("^arn:aws:sts::747240980964:assumed-role/AccountFullAccessRole/[^/]+$", self.arn))
      error_message = "Use edtosoy browser login as AccountFullAccessRole in account 747240980964."
    }
  }
}
data "aws_ami" "ubuntu" {
  owners = ["099720109477"]
  filter {
    name   = "image-id"
    values = [var.ami_id]
  }
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
  filter {
    name   = "architecture"
    values = ["arm64"]
  }
}
data "aws_subnet" "public" {
  id = var.public_subnet_id
  lifecycle {
    postcondition {
      condition     = self.vpc_id == var.vpc_id && self.owner_id == "747240980964"
      error_message = "Subnet must belong to the selected Sydney VPC/account."
    }
  }
}
data "aws_route_table" "public" {
  subnet_id = var.public_subnet_id
  lifecycle {
    postcondition {
      condition     = anytrue([for route in self.routes : route.cidr_block == "0.0.0.0/0" && startswith(coalesce(route.gateway_id, "none"), "igw-")])
      error_message = "Choose a public subnet with an Internet Gateway default route."
    }
  }
}
locals {
  secret_names = toset(["postgres-password", "provision", "ops", "ingress", "stripe-worker", "financial-worker"])
  secret_arns  = [for name in local.secret_names : "arn:aws:ssm:ap-southeast-2:747240980964:parameter/vigil/startup/${name}"]
}
resource "aws_security_group" "host" {
  name_prefix = "vigil-startup-"
  description = "Caddy HTTPS and ACME only; no SSH or PostgreSQL ingress"
  vpc_id      = var.vpc_id
  dynamic "ingress" {
    for_each = toset([80, 443])
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_iam_role" "host" {
  name = "VigilSydneyStartupHostRole"
  path = "/vigil/"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy" "host" {
  name = "VigilStartupHostReadOnly"
  role = aws_iam_role.host.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
    Resource = [for name in ["ops", "stripe", "admin"] : "arn:aws:ecr:ap-southeast-2:747240980964:repository/flow-demo/${name}"] },
    { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = local.secret_arns },
    { Effect = "Allow", Action = ["ssm:UpdateInstanceInformation", "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"], Resource = "*" },
    { Effect = "Allow", Action = ["ssm:GetDocument", "ssm:DescribeDocument"], Resource = "arn:aws:ssm:ap-southeast-2::document/AWS-RunShellScript" }
  ] })
}
resource "aws_iam_instance_profile" "host" {
  name = "VigilSydneyStartupHost"
  path = "/vigil/"
  role = aws_iam_role.host.name
}
resource "aws_ebs_volume" "data" {
  availability_zone = data.aws_subnet.public.availability_zone
  type              = "gp3"
  size              = var.data_volume_gib
  encrypted         = true
  tags              = { Name = "vigil-startup-data" }
  lifecycle { prevent_destroy = true }
}
resource "aws_instance" "host" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = "t4g.medium"
  subnet_id                   = data.aws_subnet.public.id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.host.id]
  iam_instance_profile        = aws_iam_instance_profile.host.name
  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1 # AWS credentials belong to host tools, never application containers.
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }
  user_data_replace_on_change = true
  user_data_base64 = base64gzip(templatefile("${path.module}/user-data.sh.tftpl", {
    volume_id = aws_ebs_volume.data.id
    compose   = filebase64("${path.module}/../../container/startup/compose.yaml")
    caddy     = filebase64("${path.module}/../../container/startup/Caddyfile")
    settings  = base64encode(join("\n", ["OPS_IMAGE=${var.images.ops}", "STRIPE_IMAGE=${var.images.stripe}", "ADMIN_IMAGE=${var.images.admin}", "DOMAIN=${var.domain}", "ACME_EMAIL=${var.acme_email}", ""]))
  }))
  tags       = { Name = "vigil-startup" }
  depends_on = [data.aws_caller_identity.current, data.aws_route_table.public, aws_iam_role_policy.host]
}
resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.host.id
}
resource "aws_eip" "host" {
  domain   = "vpc"
  instance = aws_instance.host.id
}
