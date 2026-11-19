"""
Email Gateway Service Module

Handles email dispatch for job applications with attachment support.
This module provides a unified interface for sending emails via SMTP
with proper error handling and logging.
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from typing import Optional, List
from pathlib import Path
from datetime import datetime
import os

logger = logging.getLogger("odyssey.email_gateway")


class EmailGateway:
    """
    Service for sending emails via SMTP with attachment support.
    
    This class handles email dispatch for job applications,
    including the tailored CV and other generated assets.
    """
    
    def __init__(self):
        """
        Initialize the Email Gateway with SMTP configuration from environment.
        """
        self.smtp_host = os.environ.get("ODYSSEY_SMTP_HOST", "")
        self.smtp_port = int(os.environ.get("ODYSSEY_SMTP_PORT", "587"))
        self.smtp_user = os.environ.get("ODYSSEY_SMTP_USER", "")
        self.smtp_pass = os.environ.get("ODYSSEY_SMTP_PASS", "")
        self.smtp_from = os.environ.get("ODYSSEY_SMTP_FROM", self.smtp_user)
        
        if not all([self.smtp_host, self.smtp_user, self.smtp_pass]):
            logger.warning("Email Gateway not fully configured - missing SMTP credentials")
        else:
            logger.info(f"Email Gateway initialized: {self.smtp_host}:{self.smtp_port}")
    
    def send_application(
        self,
        to_email: str,
        subject: str,
        body: str,
        attachments: Optional[List[dict]] = None,
        reply_to: Optional[str] = None
    ) -> dict:
        """
        Send a job application email with optional attachments.
        
        Args:
            to_email: Recipient email address
            subject: Email subject line
            body: Email body content (HTML or plain text)
            attachments: List of attachment dicts with 'path' and 'filename' keys
            reply_to: Optional reply-to email address
            
        Returns:
            Dictionary with send status and details
        """
        try:
            if not all([self.smtp_host, self.smtp_user, self.smtp_pass]):
                return {
                    "success": False,
                    "error": "Email gateway not configured",
                    "sent_at": None
                }
            
            logger.info(f"Preparing email to {to_email}: {subject}")
            
            # Create multipart message for attachments
            msg = MIMEMultipart()
            msg["Subject"] = subject
            msg["From"] = self.smtp_from
            msg["To"] = to_email
            
            if reply_to:
                msg["Reply-To"] = reply_to
            
            # Add body
            if body.startswith("<"):
                # HTML content
                msg.attach(MIMEText(body, "html", "utf-8"))
            else:
                # Plain text content
                msg.attach(MIMEText(body, "plain", "utf-8"))
            
            # Add attachments if provided
            if attachments:
                for attachment in attachments:
                    attachment_path = attachment.get("path", "")
                    attachment_name = attachment.get("filename", Path(attachment_path).name)
                    
                    if Path(attachment_path).exists():
                        try:
                            with open(attachment_path, "rb") as f:
                                part = MIMEApplication(f.read(), Name=attachment_name)
                                part["Content-Disposition"] = f'attachment; filename="{attachment_name}"'
                                msg.attach(part)
                            logger.info(f"Attached file: {attachment_name}")
                        except OSError as e:
                            logger.warning(f"Could not read attachment {attachment_path}: {e}")
                    else:
                        logger.warning(f"Attachment file not found: {attachment_path}")
            
            # Send email via SMTP
            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=30) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_pass)
                server.send_message(msg)
            
            logger.info(f"Email successfully sent to {to_email}")
            
            return {
                "success": True,
                "to_email": to_email,
                "subject": subject,
                "attachments_count": len(attachments) if attachments else 0,
                "sent_at": datetime.utcnow().isoformat() + "Z"
            }
            
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP authentication failed: {e}")
            return {
                "success": False,
                "error": "SMTP authentication failed",
                "sent_at": None
            }
        except smtplib.SMTPException as e:
            logger.error(f"SMTP error: {e}")
            return {
                "success": False,
                "error": f"SMTP error: {str(e)}",
                "sent_at": None
            }
        except Exception as e:
            logger.error(f"Email sending failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "sent_at": None
            }
    
    def send_simple(
        self,
        to_email: str,
        subject: str,
        body: str
    ) -> dict:
        """
        Send a simple email without attachments.
        
        Args:
            to_email: Recipient email address
            subject: Email subject line
            body: Email body content
            
        Returns:
            Dictionary with send status
        """
        return self.send_application(to_email, subject, body, attachments=None)
    
    def validate_email_config(self) -> dict:
        """
        Validate that the email gateway is properly configured.
        
        Returns:
            Dictionary with configuration status
        """
        config_status = {
            "configured": False,
            "host": bool(self.smtp_host),
            "user": bool(self.smtp_user),
            "pass": bool(self.smtp_pass),
            "from": bool(self.smtp_from),
            "port": self.smtp_port
        }
        
        config_status["configured"] = all([
            config_status["host"],
            config_status["user"],
            config_status["pass"]
        ])
        
        return config_status


# Singleton instance for easy import
_email_gateway: Optional[EmailGateway] = None


def get_email_gateway() -> EmailGateway:
    """
    Get or create the Email Gateway singleton instance.
    
    Returns:
        EmailGateway instance
    """
    global _email_gateway
    if _email_gateway is None:
        _email_gateway = EmailGateway()
    return _email_gateway
