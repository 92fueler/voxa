output "public_ipv4" {
  description = "Create the reviewed domain's DNS A record at this static IP."
  value       = aws_lightsail_static_ip.voxa.ip_address
}

output "ssh_username" {
  description = "Default account from the reviewed OS blueprint."
  value       = aws_lightsail_instance.voxa.username
}

output "instance_name" {
  value = aws_lightsail_instance.voxa.name
}

output "persistent_disk_name" {
  description = "Format only after inspecting the real block device; mount at /srv/voxa."
  value       = aws_lightsail_disk.data.name
}
