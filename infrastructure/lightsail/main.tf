# Infrastructure only: no provisioners, user_data, remote execution, DNS mutation,
# credentials, repository clone, package installation, or application deployment.
resource "aws_lightsail_instance" "voxa" {
  name              = var.name
  availability_zone = var.availability_zone
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  key_pair_name     = var.key_pair_name
  ip_address_type   = "ipv4"

  # Instance snapshots are not a substitute for separate DATA DISK snapshots.
  add_on {
    type          = "AutoSnapshot"
    status        = "Enabled"
    snapshot_time = "03:00"
  }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = startswith(var.availability_zone, var.aws_region)
      error_message = "availability_zone must belong to aws_region."
    }
  }
}

resource "aws_lightsail_instance_public_ports" "voxa" {
  instance_name = aws_lightsail_instance.voxa.name

  port_info {
    protocol   = "tcp"
    from_port  = 22
    to_port    = 22
    cidrs      = [var.ssh_admin_cidr]
    ipv6_cidrs = []
  }

  port_info {
    protocol   = "tcp"
    from_port  = 80
    to_port    = 80
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = []
  }

  port_info {
    protocol   = "tcp"
    from_port  = 443
    to_port    = 443
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = []
  }
}

resource "aws_lightsail_static_ip" "voxa" {
  name = "${var.name}-public"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lightsail_static_ip_attachment" "voxa" {
  static_ip_name = aws_lightsail_static_ip.voxa.name
  instance_name  = aws_lightsail_instance.voxa.name
}

resource "aws_lightsail_disk" "data" {
  name              = "${var.name}-data"
  availability_zone = var.availability_zone
  size_in_gb        = var.disk_size_gb

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lightsail_disk_attachment" "data" {
  disk_name     = aws_lightsail_disk.data.name
  instance_name = aws_lightsail_instance.voxa.name
  disk_path     = "/dev/xvdf"
}
