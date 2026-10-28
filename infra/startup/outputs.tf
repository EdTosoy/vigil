output "instance_id" { value = aws_instance.host.id }
output "public_ip" { value = aws_eip.host.public_ip }
output "data_volume_id" { value = aws_ebs_volume.data.id }
output "url" { value = "https://${var.domain}" }
