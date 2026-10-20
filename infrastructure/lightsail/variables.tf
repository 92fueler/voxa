variable "aws_region" {
  description = "Reviewed AWS region supporting Lightsail."
  type        = string
  nullable    = false
}

variable "availability_zone" {
  description = "Availability zone within aws_region for both instance and persistent disk."
  type        = string
  nullable    = false
}

variable "name" {
  description = "Resource name prefix."
  type        = string
  default     = "voxa"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.name))
    error_message = "Use 2-31 lowercase alphanumeric characters or hyphens, beginning with a letter."
  }
}

variable "blueprint_id" {
  description = "Reviewed Linux blueprint from aws lightsail get-blueprints, for example ubuntu_24_04."
  type        = string
  nullable    = false
}

variable "bundle_id" {
  description = "Reviewed IPv4-compatible instance bundle from get-bundles. No cost-incurring default."
  type        = string
  nullable    = false
}

variable "key_pair_name" {
  description = "Existing Lightsail SSH key pair in this region. No key or credential is generated."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.key_pair_name)) > 0
    error_message = "Supply an existing Lightsail key pair name."
  }
}

variable "ssh_admin_cidr" {
  description = "Exactly one administrator's public IPv4 /32. No world-open SSH."
  type        = string
  nullable    = false

  validation {
    condition = (
      can(cidrhost(var.ssh_admin_cidr, 0)) &&
      can(regex("^[0-9.]+/32$", var.ssh_admin_cidr))
    )
    error_message = "SSH requires a single IPv4 address with /32, not 0.0.0.0/0 or an IPv6 network."
  }
}

variable "disk_size_gb" {
  description = "Reviewed persistent disk capacity; disk and snapshots have separate charges."
  type        = number
  default     = 32

  validation {
    condition     = var.disk_size_gb >= 8 && var.disk_size_gb <= 256 && floor(var.disk_size_gb) == var.disk_size_gb
    error_message = "Choose an integer persistent disk size between 8 and 256 GiB."
  }
}
