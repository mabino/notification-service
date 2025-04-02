# Notification Service

Simple notification service implemented in Google Apps Script.

## Script Properties

| Property                      | Purpose                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NOTIFICATION_INTERVAL_SECONDS | Rate limit requests per token.                                                                                                                                             |
| TOKEN_LIST                    | Comma-separated list of key:value pairs designating an identifier and unique token that the client needs to present in the request as notification_token_source and token. |
