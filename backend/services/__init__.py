"""
Services Module

Contains modular service implementations for external integrations.
"""

from .crm import CRMService, get_crm_service
from .email_gateway import EmailGateway, get_email_gateway

__all__ = ["CRMService", "get_crm_service", "EmailGateway", "get_email_gateway"]
