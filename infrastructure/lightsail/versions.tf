terraform {
  required_version = ">= 1.8, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
  }
}

# Use your already-authorized local AWS profile or workload identity.
# Never put credentials, API keys, or database passwords in Terraform.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "voxa"
      ManagedBy   = "terraform"
    }
  }
}
